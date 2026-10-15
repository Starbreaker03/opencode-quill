import { RGBA, type CliRenderer, type OptimizedBuffer, type Renderable, type TextareaRenderable } from "@opentui/core"
import { completionQuery } from "./prose"
import type { Prediction, WordPredictor } from "./predictor"

export type Composer = {
  editor: TextareaRenderable
  normal: boolean
  focused: unknown
  mode: string
  selected: boolean
  enabled: boolean
}

export function dimGhostColor(muted: RGBA): RGBA {
  return RGBA.fromValues(muted.r, muted.g, muted.b, muted.a * 0.55)
}

export function eligibleComposer(view: Composer, text?: string): boolean {
  const editor = view.editor
  return view.enabled && view.normal && view.mode === "base" && !view.selected &&
    editor === view.focused && editor.focused && editor.visible && !editor.isDestroyed &&
    !!editor.parent && !editor.parent.isDestroyed && !editor.hasSelection() &&
    !editor.traits.capture?.includes("navigate") &&
    (text ?? editor.plainText).trim().length > 0 && editor.extmarks.getAll().length === 0
}

export function findComposer(marker: Renderable | undefined, isEditor: (node: Renderable) => node is TextareaRenderable): TextareaRenderable | undefined {
  if (!marker || marker.isDestroyed) return
  const editors = (node: Renderable): TextareaRenderable[] => isEditor(node) ? [node] : node.getChildren().flatMap((child) => editors(child as Renderable))
  for (let node = marker.parent; node?.parent; node = node.parent) {
    if (node.isDestroyed) return
    const found = editors(node)
    if (found.length > 1) return
    if (found.length === 1) {
      const editor = found[0]
      return typeof (editor as unknown as { getClipboardText?: unknown }).getClipboardText === "function" ? editor : undefined
    }
  }
}

export class ComposerGhost {
  private shown: { text: string; offset: number; prediction: Prediction } | undefined
  private dismissed: string | undefined
  private memo: { text: string; offset: number; prediction: Prediction | undefined } | undefined
  private disposed = false
  private readonly draw: (buffer: OptimizedBuffer, delta: number) => void

  constructor(
    readonly editor: TextareaRenderable,
    private readonly predictor: WordPredictor,
    private readonly view: () => Composer,
    private readonly color: () => RGBA,
    private readonly renderer: CliRenderer,
  ) {
    this.draw = (buffer) => { if (!this.disposed) this.paint(buffer) }
    renderer.addPostProcessFn(this.draw)
  }

  private offset(): number {
    return this.editor.editBuffer.getTextRange(0, this.editor.cursorOffset).length
  }

  invalidate(): void {
    this.memo = undefined
    this.shown = undefined
    if (!this.editor.isDestroyed) this.editor.requestRender()
  }

  private prediction(text: string, offset: number): Prediction | undefined {
    if (this.dismissed !== undefined && this.dismissed !== text) this.dismissed = undefined
    if (this.dismissed === text || !eligibleComposer(this.view(), text)) return
    if (this.memo?.text === text && this.memo.offset === offset) return this.memo.prediction
    const query = completionQuery(text, offset)
    let prediction = query && this.predictor.complete(query)
    const last = this.shown
    if (query && !query.next && last && !last.prediction.replace && text.startsWith(last.text)) {
      const typed = text.slice(last.text.length)
      if (typed && last.prediction.suffix.startsWith(typed) && typed.length < last.prediction.suffix.length) {
        prediction = { ...last.prediction, suffix: last.prediction.suffix.slice(typed.length) }
      }
    }
    this.memo = { text, offset, prediction }
    return prediction
  }

  private paint(buffer: OptimizedBuffer): void {
    if (this.editor.isDestroyed) {
      this.shown = undefined
      return
    }
    const text = this.editor.plainText
    const offset = this.offset()
    const prediction = this.prediction(text, offset)
    if (!prediction) {
      this.shown = undefined
      return
    }
    const cursor = this.editor.visualCursor
    const room = this.editor.width - cursor.visualCol
    if (room <= 0 || cursor.visualRow < 0 || cursor.visualRow >= this.editor.height) {
      this.shown = undefined
      return
    }
    const x = this.editor.screenX + cursor.visualCol
    const y = this.editor.screenY + cursor.visualRow
    const ghost = prediction.replace ? ` → ${prediction.suffix}` : prediction.suffix
    buffer.pushScissorRect(x, y, room, 1)
    try {
      buffer.drawText(ghost, x, y, this.color(), this.editor.backgroundColor)
    } finally {
      buffer.popScissorRect()
    }
    this.shown = { text, offset, prediction }
  }

  accept(): boolean {
    const shown = this.shown
    if (this.disposed || !shown || !eligibleComposer(this.view()) ||
      this.editor.plainText !== shown.text || this.offset() !== shown.offset) return false
    if (!completionQuery(shown.text, shown.offset)) return false
    this.shown = undefined
    if (shown.prediction.replace) {
      this.editor.replaceText(shown.text.slice(0, shown.text.length - shown.prediction.replace) + shown.prediction.suffix)
      this.editor.gotoBufferEnd()
    } else {
      this.editor.insertText(shown.prediction.suffix)
    }
    this.editor.requestRender()
    return true
  }

  dismiss(): boolean {
    if (this.disposed || !this.shown || !eligibleComposer(this.view()) ||
      this.editor.plainText !== this.shown.text || this.offset() !== this.shown.offset) return false
    this.dismissed = this.editor.plainText
    this.shown = undefined
    this.editor.requestRender()
    return true
  }

  visible(): boolean {
    return !this.disposed && !!this.shown && eligibleComposer(this.view()) &&
      this.editor.plainText === this.shown.text && this.offset() === this.shown.offset
  }

  dispose(): void {
    this.disposed = true
    this.shown = undefined
    if (!this.renderer.isDestroyed) this.renderer.removePostProcessFn(this.draw)
    if (this.editor.isDestroyed) return
    this.editor.requestRender()
  }
}
