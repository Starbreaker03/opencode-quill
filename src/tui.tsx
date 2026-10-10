import { Plugin } from "@opencode/plugin/tui"
import { InputRenderable, TextareaRenderable, type BoxRenderable } from "@opentui/core"
import { createEffect, createRoot, createSignal, onCleanup, untrack } from "solid-js"
import frequencies from "subtlex-word-frequencies"
import { ComposerGhost, dimGhostColor, findComposer } from "./ghost"
import { completionLayer } from "./keymap"
import { parseQuillCommand, resolveOptions } from "./options"
import { emptySnapshot, PersonalModel, WordPredictor } from "./predictor"

export default Plugin.define({
  id: "quill",
  setup(context) {
    const options = resolveOptions(context.options)
    const [settings, setSettings] = context.storage.store("settings", {
      initial: { enabled: options.enabled },
    })
    const [learning, setLearning] = context.storage.store("learning", {
      initial: { snapshot: emptySnapshot() },
    })
    const predictor = new WordPredictor(frequencies)
    const composers = new Map<string, { marker: BoxRenderable; normal: () => boolean }>()
    const seeded = new Set<string>()
    const inFlight = new Set<string>()
    const [revision, setRevision] = createSignal(0)
    let ghost: ComposerGhost | undefined
    let disposed = false
    let warned = false

    const routeKey = () => {
      const route = context.ui.router.current()
      return route.type === "home" ? "home" : route.type === "session" ? route.sessionID : undefined
    }

    const currentEditor = () => {
      const key = routeKey()
      const composer = key && composers.get(key)
      return composer ? findComposer(composer.marker, (node): node is TextareaRenderable => node instanceof TextareaRenderable && !(node instanceof InputRenderable)) : undefined
    }

    const syncEditor = () => {
      if (disposed) return
      const editor = currentEditor()
      if (ghost?.editor === editor) return
      ghost?.dispose()
      ghost = editor && new ComposerGhost(editor, predictor, () => {
        const key = routeKey()
        return {
          editor,
          normal: !!key && composers.get(key)?.normal() === true,
          focused: context.renderer.currentFocusedEditor,
          mode: context.keymap.mode.current(),
          selected: context.renderer.hasSelection,
          enabled: !disposed && settings.enabled && currentEditor() === editor,
        }
      }, () => dimGhostColor(context.theme.text.muted), context.renderer)
    }

    const learn = async (sessionID: string) => {
      if (disposed || !settings.enabled || inFlight.has(sessionID)) return
      inFlight.add(sessionID)
      try {
        await context.data.session.message.sync(sessionID)
        if (disposed || !settings.enabled) return
        const prompts = context.data.session.message.list(sessionID)
          .filter((message) => message.type === "user")
          .slice(-200)
          .map((message) => ({ id: `${sessionID}:${message.id}`, text: message.text }))
        const model = new PersonalModel(learning.snapshot)
        if (!model.observe(prompts)) return
        await setLearning((draft) => {
          const latest = new PersonalModel(draft.snapshot)
          if (latest.observe(prompts)) draft.snapshot = latest.snapshot()
        })
      } catch {
        if (!disposed && !warned) {
          warned = true
          context.ui.toast.show({ title: "Quill", message: "History learning unavailable; vocabulary completion is still active.", variant: "warning" })
        }
      } finally {
        inFlight.delete(sessionID)
      }
    }

    const disposeEffects = createRoot((dispose) => {
      createEffect(() => {
        predictor.setPersonal(learning.snapshot)
        ghost?.invalidate()
      })
      createEffect(() => {
        revision()
        routeKey()
        settings.enabled
        context.keymap.mode.current()
        syncEditor()
        ghost?.invalidate()
      })
      createEffect(() => {
        if (!settings.enabled) return
        const route = context.ui.router.current()
        if (route.type === "session") untrack(() => { void learn(route.sessionID) })
        for (const session of context.data.session.list().filter((session) => !session.parentID).sort((a, b) => b.time.updated - a.time.updated).slice(0, 8)) {
          if (seeded.has(session.id)) continue
          seeded.add(session.id)
          untrack(() => { void learn(session.id) })
        }
      })
      return dispose
    })

    const beforeRender = async () => { syncEditor() }
    context.renderer.setFrameCallback(beforeRender)
    const offStarted = context.data.on("session.execution.started", (event) => { void learn(event.data.sessionID) })
    const offSucceeded = context.data.on("session.execution.succeeded", (event) => { void learn(event.data.sessionID) })
    const offDelivered = context.data.on("session.inbox.delivered", (event) => { void learn(event.data.sessionID) })

    context.keymap.layer(() => completionLayer(options, () => ghost))
    context.keymap.layer(() => ({
      mode: "global",
      commands: [
        {
          id: "quill.toggle",
          title: `Word autocomplete: ${settings.enabled ? "on" : "off"}`,
          description: "Toggle local word suggestions",
          group: "Prompt",
          palette: true,
          slash: { name: "quill", arguments: true },
          run: async (input) => {
            const command = parseQuillCommand(input)
            if (command.type === "clear") {
              predictor.setPersonal(emptySnapshot())
              await setLearning((draft) => { draft.snapshot = emptySnapshot() })
              ghost?.invalidate()
              context.ui.toast.show({ title: "Quill", message: "Word autocomplete history cleared" })
              return
            }
            if (command.type === "invalid") {
              context.ui.toast.show({ title: "Quill", message: "Use /quill, /quill on, /quill off, or /quill clear", variant: "warning" })
              return
            }
            const enabled = command.type === "enable" ? command.value : !settings.enabled
            await setSettings((draft) => { draft.enabled = enabled })
            ghost?.invalidate()
            context.ui.toast.show({ title: "Quill", message: `Word autocomplete: ${enabled ? "on" : "off"}` })
          },
        },
        {
          id: "quill.clear",
          title: "Clear word autocomplete history",
          description: "Reset learned vocabulary, n-grams, and prompt transitions",
          group: "Prompt",
          palette: true,
          run: async () => {
            predictor.setPersonal(emptySnapshot())
            await setLearning((draft) => { draft.snapshot = emptySnapshot() })
            ghost?.invalidate()
            context.ui.toast.show({ title: "Quill", message: "Word autocomplete history cleared" })
          },
        },
      ],
    }))

    const offComposer = context.ui.slot({
      append: "prompt.footer",
      render(input) {
        const [marker, setMarker] = createSignal<BoxRenderable>()
        createEffect(() => {
          const key = input.sessionID ?? "home"
          const node = marker()
          if (!node) return
          composers.set(key, { marker: node, normal: () => input.mode === "normal" })
          setRevision((value) => value + 1)
          onCleanup(() => {
            if (composers.get(key)?.marker !== node) return
            composers.delete(key)
            setRevision((value) => value + 1)
          })
        })
        return <box width={0} height={0} ref={setMarker} />
      },
    })

    return () => {
      disposed = true
      context.renderer.removeFrameCallback(beforeRender)
      disposeEffects()
      offStarted()
      offSucceeded()
      offDelivered()
      offComposer()
      ghost?.dispose()
      composers.clear()
    }
  },
})
