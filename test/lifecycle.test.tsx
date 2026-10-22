import { expect, spyOn, test } from "bun:test"
import { RGBA, type TextareaRenderable } from "@opentui/core"
import { createTestRenderer } from "@opentui/core/testing"
import { render, type JSX } from "@opentui/solid"
import { createSignal, Show } from "solid-js"
import { createStore, produce } from "solid-js/store"
import type { KeymapLayer } from "@opencode/plugin/tui/context"
import { PersonalModel, type Snapshot } from "../src/predictor"
import plugin from "../src/tui"

test("mounted footer slots switch route ghosts, dispose on unmount, and release stale key capture", async () => {
  const testing = await createTestRenderer({ width: 60, height: 10 })
  const [route, setRoute] = createSignal("home")
  const [mounted, setMounted] = createSignal(true)
  const model = new PersonalModel()
  model.observe(Array.from({ length: 20 }, (_, index) => ({ id: `fixture:${index}`, text: "please complete" })))
  const [learning, setLearning] = createStore({ snapshot: model.snapshot() })
  const [settings] = createStore({ enabled: true })
  const layers: (() => KeymapLayer)[] = []
  let footer!: (input: { sessionID?: string; mode: "normal"; showDetails: boolean }) => JSX.Element
  let home!: TextareaRenderable
  let session!: TextareaRenderable
  const removed = spyOn(testing.renderer, "removePostProcessFn")
  const context = {
    options: {},
    theme: { text: { muted: RGBA.fromHex("#888888") } },
    storage: { store: (key: string) => key === "settings" ? [settings, async () => {}] : [learning, async (mutate: (draft: { snapshot: Snapshot }) => void) => { setLearning(produce(mutate)) }] },
    data: { session: { list: () => [], message: { sync: async () => {}, list: () => [] } }, on: () => () => {} },
    ui: {
      router: { current: () => route() === "home" ? { type: "home" } : { type: "session", sessionID: route() } },
      toast: { show: () => {} },
      slot: (registration: { render: typeof footer }) => { footer = registration.render; return () => {} },
    },
    keymap: { mode: { current: () => "base" }, layer: (factory: () => KeymapLayer) => { layers.push(factory) } },
    renderer: testing.renderer,
  } as unknown as Parameters<typeof plugin.setup>[0]
  let dispose = await plugin.setup(context)
  const Composer = (props: { sessionID?: string; editor: (editor: TextareaRenderable) => void }) => <box height={4}>
    <textarea ref={(editor) => {
      Object.defineProperty(editor, "getClipboardText", { value: () => "", configurable: true })
      props.editor(editor)
    }} width={60} height={2} />
    <box height={1}>{footer({ sessionID: props.sessionID, mode: "normal", showDetails: false })}</box>
  </box>
  const accept = () => layers.flatMap((layer) => layer().commands ?? []).find((command) => command.id === "quill.accept")!
  const enabled = () => { const value = accept().enabled; return typeof value === "function" ? value() : value }
  const frame = async () => { await new Promise<void>((resolve) => setImmediate(resolve)); await testing.renderOnce() }
  try {
    await render(() => <box>
      <Composer editor={(editor) => { home = editor }} />
      <Show when={mounted()}><Composer sessionID="session" editor={(editor) => { session = editor }} /></Show>
    </box>, testing.renderer)
    home.setText("please comp")
    home.gotoBufferEnd()
    home.focus()
    await frame()
    expect(enabled(), "home suggestion").toBe(true)
    expect(home.plainText).toBe("please comp")
    const before = removed.mock.calls.length
    session.setText("please comp")
    session.gotoBufferEnd()
    session.focus()
    setRoute("session")
    await frame()
    expect(removed.mock.calls.length).toBeGreaterThan(before)
    expect(enabled(), "session suggestion").toBe(true)
    await accept().run?.()
    expect(session.plainText).not.toBe("please comp")
    expect(home.plainText).toBe("please comp")
    setMounted(false)
    await frame()
    expect(session.isDestroyed).toBe(true)
    expect(enabled()).toBe(false)
    expect(await accept().run?.()).toBe(false)
    home.focus()
    setRoute("home")
    await frame()
    expect(enabled(), "home rebound suggestion").toBe(true)
    await dispose?.()
    dispose = undefined
    expect(enabled()).toBe(false)
    expect(await accept().run?.()).toBe(false)
    expect(home.plainText).toBe("please comp")
  } finally {
    await dispose?.()
    removed.mockRestore()
    testing.renderer.destroy()
  }
})
