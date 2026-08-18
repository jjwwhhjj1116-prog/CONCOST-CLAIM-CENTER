export type MemoryScope = 'GLOBAL' | 'REPORT_TYPE' | 'CLAIM_TYPE' | 'CHAPTER' | 'CLIENT' | 'USER_FEEDBACK';

export interface FeedbackAnalysisInput {
  feedback: string;
  scope: MemoryScope;
  scopeKey: string;
  chapterCode: string;
  beforeText: string;
  afterText: string;
}

export interface FeedbackAnalysis {
  problem: string;
  rule: string;
  confidence: number;
  tags: string[];
  diff: {
    beforeCharacters: number;
    afterCharacters: number;
    beforeLines: number;
    afterLines: number;
    lengthChangePercent: number;
  };
  analyzer: 'HERMES_COMPATIBLE_RULE_ENGINE_V1';
}

export interface MemoryAgent {
  analyzeFeedback(input: FeedbackAnalysisInput): FeedbackAnalysis;
  composePrompt(rules: readonly string[]): string;
}

const normalize = (value: string): string => value.replace(/\s+/gu, ' ').trim();

export class HermesCompatibleMemoryAgent implements MemoryAgent {
  analyzeFeedback(input: FeedbackAnalysisInput): FeedbackAnalysis {
    const feedback = normalize(input.feedback);
    const tags: string[] = [];
    let problem = '사용자가 다음 작성에서 반복하지 않기를 요청한 편집 패턴';
    let rule = `다음 사용자 승인 피드백을 지켜 작성한다: ${feedback}`;
    let confidence = 70;

    if (/길|장황|반복|간결|짧/u.test(feedback)) {
      problem = '불필요한 반복 또는 장문으로 핵심 쟁점이 흐려짐';
      rule = '핵심 사실 → 근거 → 판단 순서로 쓰고, 같은 의미의 반복 문장은 제거한다.';
      tags.push('BREVITY', 'STRUCTURE'); confidence = 86;
    }
    if (/단정|확정적|책임/u.test(feedback)) {
      problem = '근거 범위를 넘는 단정적 책임 표현';
      rule = '책임과 인과관계는 확인된 근거 범위에서만 서술하고, 불확실하면 [확인 필요]로 표시한다.';
      tags.push('EVIDENCE_BOUNDARY', 'TONE'); confidence = Math.max(confidence, 90);
    }
    if (/계약|조항/u.test(feedback)) {
      problem = '계약 근거가 분석 또는 결론보다 늦게 제시됨';
      rule = '관련 계약조항과 근거 식별자를 먼저 제시한 뒤 사실 분석과 결론을 작성한다.';
      tags.push('CONTRACT_FIRST', 'EVIDENCE'); confidence = Math.max(confidence, 88);
    }
    if (/용어|표현|안 씀|쓰지/u.test(feedback)) {
      problem = '회사 승인 문체 또는 용어와 맞지 않는 표현 사용';
      rule = `회사 승인 용어를 우선하고 다음 피드백에서 지적된 표현을 반복하지 않는다: ${feedback}`;
      tags.push('TERMINOLOGY', 'STYLE'); confidence = Math.max(confidence, 82);
    }
    if (!tags.length) tags.push('USER_FEEDBACK');

    const beforeCharacters = input.beforeText.length;
    const afterCharacters = input.afterText.length;
    return {
      problem,
      rule: normalize(rule).slice(0, 800),
      confidence,
      tags: [...new Set(tags)],
      diff: {
        beforeCharacters,
        afterCharacters,
        beforeLines: input.beforeText.split(/\r?\n/u).length,
        afterLines: input.afterText.split(/\r?\n/u).length,
        lengthChangePercent: beforeCharacters ? Math.round(((afterCharacters - beforeCharacters) / beforeCharacters) * 100) : 0
      },
      analyzer: 'HERMES_COMPATIBLE_RULE_ENGINE_V1'
    };
  }

  composePrompt(rules: readonly string[]): string {
    if (!rules.length) return '';
    return `\n\n[관리자 승인 AI Memory]\n${rules.map((rule, index) => `${index + 1}. ${normalize(rule)}`).join('\n')}\n위 규칙은 사실 근거를 대체하지 않으며 서로 충돌하면 더 구체적인 범위와 최근 관리자 승인을 우선합니다.`;
  }
}

export function extractGeneratedChapter(report: string, chapterCode: string): string | null {
  const escaped = chapterCode.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  const match = report.match(new RegExp(`<!-- AI-CHAPTER:${escaped}:START -->\\s*[\\s\\S]*?\\n\\n([\\s\\S]*?)\\n<!-- AI-CHAPTER:${escaped}:END -->`, 'u'));
  return match?.[1]?.trim() || null;
}

export const defaultMemoryAgent: MemoryAgent = new HermesCompatibleMemoryAgent();
