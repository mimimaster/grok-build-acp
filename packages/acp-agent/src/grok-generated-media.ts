import type { ToolPresentation } from '@piwin/contracts';

/** Grok 1.0.46 reports generated files as a JSON receipt in content text. */
export function normalizeGrokMediaPresentation(
  toolName: string,
  presentation: ToolPresentation,
): ToolPresentation {
  const kind = toolName === 'image_gen' ? 'image' : toolName === 'video_gen' ? 'video' : undefined;
  if (kind === undefined) return presentation;
  let path: string | undefined;
  try {
    const receipt: unknown = JSON.parse(presentation.output?.text ?? '');
    if (typeof receipt === 'object' && receipt !== null && !Array.isArray(receipt)) {
      const value = (receipt as Record<string, unknown>).path;
      if (typeof value === 'string' && value.trim() !== '') path = value;
    }
  } catch {
    // Progress text and unstructured errors are not file receipts.
  }
  return {
    ...presentation,
    kind,
    routedToolName: toolName,
    ...(path !== undefined ? { targetPaths: [path] } : {}),
  };
}
