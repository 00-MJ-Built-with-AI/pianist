/** Mock exam marking: scales, pieces and sight-reading, combined into one mark. */

export type ExamPart = 'scales' | 'pieces' | 'sight';

/** How much each part counts (renormalised when a part is left out). */
export const EXAM_WEIGHTS: Record<ExamPart, number> = { scales: 20, pieces: 60, sight: 20 };

export function gradeFor(total: number): string {
  if (total >= 87) return 'Distinction';
  if (total >= 75) return 'Merit';
  if (total >= 60) return 'Pass';
  return 'Not yet';
}

/** The combined mark: each part's average, weighted. Items not played count 0. */
export function examTotal(items: Array<{ part: ExamPart; score: number | null }>): number {
  let sum = 0;
  let weight = 0;
  for (const part of ['scales', 'pieces', 'sight'] as ExamPart[]) {
    const scores = items.filter((i) => i.part === part).map((i) => i.score ?? 0);
    if (!scores.length) continue;
    sum += (EXAM_WEIGHTS[part] * scores.reduce((a, b) => a + b, 0)) / scores.length;
    weight += EXAM_WEIGHTS[part];
  }
  return weight ? Math.round(sum / weight) : 0;
}
