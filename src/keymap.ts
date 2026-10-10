import type { KeymapLayer } from "@opencode/plugin/tui/context"
import type { Options } from "./options"

type Suggestion = { visible(): boolean; accept(): boolean; dismiss(): boolean }

export function completionLayer(options: Options, suggestion: () => Suggestion | undefined): KeymapLayer {
  return {
    mode: "base",
    priority: 2,
    commands: [
      {
        id: "quill.accept",
        title: "Accept word suggestion",
        bind: options.acceptKeys.length ? options.acceptKeys.join(",") : false,
        enabled: () => suggestion()?.visible() === true,
        run: () => suggestion()?.accept() ? undefined : false,
      },
      {
        id: "quill.dismiss",
        title: "Dismiss word suggestion",
        bind: options.dismissKeys.length ? options.dismissKeys.join(",") : false,
        enabled: () => suggestion()?.visible() === true,
        run: () => suggestion()?.dismiss() ? undefined : false,
      },
    ],
  }
}
