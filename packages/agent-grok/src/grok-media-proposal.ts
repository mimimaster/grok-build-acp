import { relative, resolve, sep } from 'node:path';
import { normalizeGrokMediaPresentation } from '@piwin/acp-agent';
import type { AgentEvent, AgentPluginMediaProposal } from '@piwin/contracts';
import { grokSessionOutputRoot, type GrokOutputContext } from './grok-output-context.js';

const DIRECTORY_IDS = { image: 'images', video: 'videos' } as const;

/** Identify a native Grok file and propose only a relative name. Host decides whether to import it. */
export function attachGrokMediaProposal(
  event: AgentEvent,
  context: GrokOutputContext,
): { event: AgentEvent; media?: AgentPluginMediaProposal[] } {
  if (event.type !== 'tool/end' || event.isError || !event.presentation) return { event };
  const presentation = normalizeGrokMediaPresentation(event.presentation.routedToolName ?? '', event.presentation);
  if (presentation.kind !== 'image' && presentation.kind !== 'video') return { event: { ...event, presentation } };
  const sourcePath = presentation.targetPaths?.[0];
  const relativePath = sourcePath === undefined ? undefined : relativePathWithin(
    resolve(grokSessionOutputRoot(context), DIRECTORY_IDS[presentation.kind]),
    sourcePath,
  );
  const presentationWithoutGrant = stripSourcePath(presentation, sourcePath, relativePath);
  if (relativePath === undefined) return { event: { ...event, presentation: presentationWithoutGrant } };
  return {
    event: { ...event, presentation: presentationWithoutGrant },
    media: [{
      directoryId: DIRECTORY_IDS[presentation.kind],
      relativePath,
      kind: presentation.kind,
      importKey: `grok:${context.backendSessionId}:${relativePath}`,
      prompt: presentation.title.replace(/^(?:imagine|image_gen|video_gen):\s*/u, ''),
      ...(presentation.endedAt ? { createdAt: presentation.endedAt } : {}),
    }],
  };
}

function stripSourcePath(
  presentation: NonNullable<Extract<AgentEvent, { type: 'tool/end' }>['presentation']>,
  sourcePath: string | undefined,
  relativePath: string | undefined,
) {
  const { targetPaths: _grant, output, ...rest } = presentation;
  const text = sourcePath && output?.text ? output.text.split(sourcePath).join(relativePath ?? '[redacted]') : output?.text;
  return {
    ...rest,
    ...(relativePath ? { targetPaths: [relativePath] } : {}),
    ...(text !== undefined && output ? { output: { ...output, text } } : {}),
  };
}

function relativePathWithin(root: string, sourcePath: string): string | undefined {
  const resolvedRoot = resolve(root);
  const resolvedSource = resolve(sourcePath);
  if (resolvedSource !== resolvedRoot && !resolvedSource.startsWith(resolvedRoot + sep)) return undefined;
  const value = relative(resolvedRoot, resolvedSource);
  return value.split(sep).every((segment) => segment !== '..' && segment !== '' && !segment.includes('\0')) ? value : undefined;
}
