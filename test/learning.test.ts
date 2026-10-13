import { afterEach, expect, mock, test } from "bun:test"
import { createStore, produce } from "solid-js/store"
import { emptySnapshot, type Snapshot } from "../src/predictor"
import plugin from "../src/tui"

type Message = { id: string; type: "user"; text: string }
type Layer = { commands?: { id?: string; run?: (input?: string) => unknown }[] }
const cleanups: (() => void | Promise<void>)[] = []
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup() })
const settle = () => new Promise<void>((resolve) => setImmediate(resolve))

async function setup(sync: () => Promise<void>, initialMessages: Message[] = [], initialWrite?: Promise<void>, route = "home") {
  let messages = initialMessages
  let writeGate = initialWrite
  const [learning, setLearning] = createStore({ snapshot: emptySnapshot() })
  const [settings, setSettings] = createStore({ enabled: true })
  const listeners = new Map<string, (event: { data: { sessionID: string } }) => void>()
  const layers: (() => Layer)[] = []
  const toast = mock(() => {})
  const context = {
    options: {},
    storage: {
      store: (key: string) => key === "settings"
        ? [settings, async (mutate: (draft: { enabled: boolean }) => void) => { setSettings(produce(mutate)) }]
        : [learning, async (mutate: (draft: { snapshot: Snapshot }) => void) => {
          if (writeGate) await writeGate
          setLearning(produce(mutate))
        }],
    },
    data: {
      session: {
        list: () => [{ id: "session", time: { updated: 1 } }],
        message: { sync, list: () => messages },
      },
      on: (name: string, listener: (event: { data: { sessionID: string } }) => void) => {
        listeners.set(name, listener)
        return () => { listeners.delete(name) }
      },
    },
    ui: {
      router: { current: () => route === "home" ? { type: "home" } : { type: "session", sessionID: "session" } },
      toast: { show: toast },
      slot: () => () => {},
    },
    keymap: { mode: { current: () => "base" }, layer: (factory: () => Layer) => { layers.push(factory) } },
    renderer: { setFrameCallback: () => {}, removeFrameCallback: () => {} },
  } as unknown as Parameters<typeof plugin.setup>[0]
  const dispose = await plugin.setup(context)
  if (dispose) cleanups.push(dispose)
  return {
    learning,
    toast,
    setMessages: (value: Message[]) => { messages = value },
    setWriteGate: (value: Promise<void> | undefined) => { writeGate = value },
    emit: (name: string) => { listeners.get(name)?.({ data: { sessionID: "session" } }) },
    run: async (id: string, input?: string) => {
      const command = layers.flatMap((layer) => layer().commands ?? []).find((command) => command.id === id)
      if (!command?.run) throw new Error(`Missing command: ${id}`)
      await command.run(input)
    },
  }
}

test("coalesces concurrent session events into one follow-up sync after an empty backfill", async () => {
  const first = Promise.withResolvers<void>()
  const second = Promise.withResolvers<void>()
  let calls = 0
  const sync = mock(() => (++calls === 1 ? first.promise : second.promise))
  const fixture = await setup(sync)
  expect(sync).toHaveBeenCalledTimes(1)
  fixture.emit("session.execution.started")
  fixture.emit("session.inbox.delivered")
  first.resolve()
  await settle()
  expect(sync).toHaveBeenCalledTimes(2)
  fixture.setMessages([{ id: "new", type: "user", text: "please run tests" }])
  second.resolve()
  await settle()
  expect(fixture.learning.snapshot.seen).toEqual(["session:new"])
  expect(sync).toHaveBeenCalledTimes(2)
})

test("deduplicates overlapping startup and route backfills", async () => {
  const pending = Promise.withResolvers<void>()
  const sync = mock(() => pending.promise)
  await setup(sync, [], undefined, "session")
  expect(sync).toHaveBeenCalledTimes(1)
  pending.resolve()
  await settle()
  expect(sync).toHaveBeenCalledTimes(1)
})

test.each(["quill.clear", "quill.toggle"])("%s cancels stale syncs and queued pre-clear events", async (command) => {
  const pending = Promise.withResolvers<void>()
  const sync = mock(() => pending.promise)
  const fixture = await setup(sync, [{ id: "old", type: "user", text: "please run tests" }])
  fixture.emit("session.execution.started")
  await fixture.run(command, command === "quill.toggle" ? "clear" : undefined)
  pending.resolve()
  await settle()
  expect(fixture.learning.snapshot).toEqual(emptySnapshot())
  expect(sync).toHaveBeenCalledTimes(1)
})

test("a session event after clear still queues a fresh learning pass", async () => {
  const first = Promise.withResolvers<void>()
  const second = Promise.withResolvers<void>()
  let calls = 0
  const sync = mock(() => (++calls === 1 ? first.promise : second.promise))
  const fixture = await setup(sync)
  await fixture.run("quill.clear")
  fixture.emit("session.inbox.delivered")
  first.resolve()
  await settle()
  expect(sync).toHaveBeenCalledTimes(2)
  fixture.setMessages([{ id: "new", type: "user", text: "please run tests" }])
  second.resolve()
  await settle()
  expect(fixture.learning.snapshot.seen).toEqual(["session:new"])
})

test("a storage mutation queued before clear cannot restore the old model", async () => {
  const write = Promise.withResolvers<void>()
  const fixture = await setup(async () => {}, [{ id: "old", type: "user", text: "please run tests" }], write.promise)
  await settle()
  fixture.setWriteGate(undefined)
  await fixture.run("quill.clear")
  write.resolve()
  await settle()
  expect(fixture.learning.snapshot).toEqual(emptySnapshot())
})

test("a queued live event retains warning behavior after a silent backfill fails", async () => {
  const first = Promise.withResolvers<void>()
  let calls = 0
  const sync = mock(async () => {
    if (++calls === 1) await first.promise
    else throw new Error("unavailable")
  })
  const fixture = await setup(sync)
  fixture.emit("session.execution.started")
  first.reject(new Error("unavailable"))
  await settle()
  expect(sync).toHaveBeenCalledTimes(2)
  expect(fixture.toast).toHaveBeenCalledTimes(1)
})
