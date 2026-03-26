import { NextRequest, NextResponse } from 'next/server'

import {
  applyAiTriageResult,
  markTriageFallback,
} from '@/components/demo/demoLogic'
import type {
  DemoAction,
  DemoSignal,
  DemoTask,
  DemoTriage,
  Severity,
  TriageDecision,
} from '@/components/demo/demoData'

const OPENAI_RESPONSES_URL = 'https://api.openai.com/v1/responses'
const MODEL = process.env.OPENAI_TRIAGE_MODEL ?? 'gpt-4o-mini'

type RouteBody = {
  tasks: DemoTask[]
  signals: DemoSignal[]
  triage: Record<string, DemoTriage>
  actions: DemoAction[]
}

type AiBatchResponse = {
  triage: Array<{
    signalId: string
    severity: Severity
    decision: TriageDecision
    confidence: number
    reasoning: string
    suggestedRemediation: string
  }>
}

type RouteUsage = {
  aiCalls: number
  inputTokens: number
  outputTokens: number
  totalTokens: number
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isSeverity(value: unknown): value is Severity {
  return value === 'low' || value === 'medium' || value === 'high' || value === 'critical'
}

function isDecision(value: unknown): value is TriageDecision {
  return (
    value === 'ignore' ||
    value === 'monitor' ||
    value === 'escalate' ||
    value === 'auto_fix'
  )
}

function extractOutputText(payload: Record<string, unknown>) {
  if (typeof payload.output_text === 'string' && payload.output_text.length > 0) {
    return payload.output_text
  }

  const output = Array.isArray(payload.output) ? payload.output : []

  for (const item of output) {
    if (!isObject(item)) {
      continue
    }

    const content = Array.isArray(item.content) ? item.content : []

    for (const entry of content) {
      if (!isObject(entry)) {
        continue
      }

      if (typeof entry.text === 'string' && entry.text.length > 0) {
        return entry.text
      }
    }
  }

  return ''
}

function normalizeAiBatchResponse(value: unknown): AiBatchResponse | null {
  if (!isObject(value) || !Array.isArray(value.triage)) {
    return null
  }

  const triage = value.triage
    .map((entry) => {
      if (!isObject(entry)) {
        return null
      }

      const {
        signalId,
        severity,
        decision,
        confidence,
        reasoning,
        suggestedRemediation,
      } = entry

      if (
        typeof signalId !== 'string' ||
        !isSeverity(severity) ||
        !isDecision(decision) ||
        typeof confidence !== 'number' ||
        typeof reasoning !== 'string' ||
        typeof suggestedRemediation !== 'string'
      ) {
        return null
      }

      return {
        signalId,
        severity,
        decision,
        confidence,
        reasoning,
        suggestedRemediation,
      }
    })
    .filter((entry): entry is AiBatchResponse['triage'][number] => entry !== null)

  return { triage }
}

function buildPrompt(body: RouteBody) {
  const actionIndex = new Map<string, DemoAction[]>()

  for (const action of body.actions) {
    const group = actionIndex.get(action.signalId) ?? []
    group.push(action)
    actionIndex.set(action.signalId, group)
  }

  const signalContexts = body.signals.map((signal) => {
    const task = body.tasks.find((item) => item.id === signal.taskId)
    const baseline = body.triage[signal.id]
    const recentActions = actionIndex.get(signal.id) ?? []

    return {
      signalId: signal.id,
      signalType: signal.kind,
      signalTitle: signal.title,
      signalSummary: signal.summary,
      expectationViolated: baseline?.expectationViolated ?? '',
      baselineDecision: baseline?.decision ?? 'monitor',
      task: task
        ? {
            id: task.id,
            title: task.title,
            status: task.status,
            priority: task.priority,
            owner: task.owner,
            daysInStatus: task.daysInStatus,
            dueInDays: task.dueInDays,
          }
        : null,
      recentActions: recentActions.map((action) => ({
        type: action.type,
        message: action.message,
        repeatCount: action.repeatCount,
      })),
    }
  })

  return [
    'You are triaging anomalies in a self-triaging to-do system.',
    'Rule-based detection has already produced the signals below.',
    'Return JSON only.',
    'For each signal, classify severity and decision, provide confidence from 0 to 1, concise reasoning, and a short suggested remediation.',
    'You may recommend auto_fix only when a deterministic fallback correction seems safe; do not assume you can mutate state directly.',
    'Keep reasoning under 30 words per signal.',
    JSON.stringify({ signals: signalContexts }),
  ].join('\n')
}

function buildFallbackResponse(
  body: RouteBody,
  fallbackReason: string,
  status = 200,
) {
  const triage = Object.fromEntries(
    body.signals.map((signal) => [
      signal.id,
      markTriageFallback(
        body.triage[signal.id] ?? {
          signalId: signal.id,
          expectationViolated: 'Task state should remain internally consistent.',
          severity: 'low',
          confidence: 0.5,
          decision: 'ignore',
          reasoning:
            'The deterministic fallback could not recover a complete baseline triage record.',
          source: 'fallback',
        },
        fallbackReason,
      ),
    ]),
  )
  return NextResponse.json(
    {
      triage,
      mode: 'fallback' as const,
      usage: {
        aiCalls: 0,
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
      },
    },
    { status },
  )
}

export async function POST(request: NextRequest) {
  let body: RouteBody

  try {
    body = (await request.json()) as RouteBody
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  if (
    !Array.isArray(body.tasks) ||
    !Array.isArray(body.signals) ||
    !isObject(body.triage) ||
    !Array.isArray(body.actions)
  ) {
    return NextResponse.json({ error: 'Invalid triage payload' }, { status: 400 })
  }

  if (body.signals.length === 0) {
    return NextResponse.json({
      triage: {},
      mode: 'fallback' as const,
      usage: {
        aiCalls: 0,
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
      },
    })
  }

  const apiKey = process.env.OPENAI_API_KEY

  if (!apiKey) {
    return buildFallbackResponse(
      body,
      'No API key was configured, so the deterministic baseline was used.',
      200,
    )
  }

  try {
    const response = await fetch(OPENAI_RESPONSES_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: MODEL,
        input: buildPrompt(body),
        max_output_tokens: 350,
        text: {
          format: {
            type: 'json_schema',
            name: 'demo_triage_batch',
            strict: true,
            schema: {
              type: 'object',
              additionalProperties: false,
              properties: {
                triage: {
                  type: 'array',
                  items: {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                      signalId: { type: 'string' },
                      severity: {
                        type: 'string',
                        enum: ['low', 'medium', 'high', 'critical'],
                      },
                      decision: {
                        type: 'string',
                        enum: ['ignore', 'monitor', 'escalate', 'auto_fix'],
                      },
                      confidence: { type: 'number' },
                      reasoning: { type: 'string' },
                      suggestedRemediation: { type: 'string' },
                    },
                    required: [
                      'signalId',
                      'severity',
                      'decision',
                      'confidence',
                      'reasoning',
                      'suggestedRemediation',
                    ],
                  },
                },
              },
              required: ['triage'],
            },
          },
        },
      }),
    })

    if (!response.ok) {
      await response.text()
      return buildFallbackResponse(
        body,
        `AI triage was unavailable (${response.status}), so the deterministic baseline was used.`,
        200,
      )
    }

    const payload = (await response.json()) as Record<string, unknown>
    const outputText = extractOutputText(payload)
    const usagePayload = isObject(payload.usage) ? payload.usage : {}
    const usage: RouteUsage = {
      aiCalls: 1,
      inputTokens:
        typeof usagePayload.input_tokens === 'number'
          ? usagePayload.input_tokens
          : 0,
      outputTokens:
        typeof usagePayload.output_tokens === 'number'
          ? usagePayload.output_tokens
          : 0,
      totalTokens:
        typeof usagePayload.total_tokens === 'number'
          ? usagePayload.total_tokens
          : 0,
    }

    if (!outputText) {
      return buildFallbackResponse(
        body,
        'The AI response was empty, so the deterministic baseline was used.',
      )
    }

    const parsed = normalizeAiBatchResponse(JSON.parse(outputText))

    if (!parsed) {
      return buildFallbackResponse(
        body,
        'The AI response could not be parsed, so the deterministic baseline was used.',
      )
    }

    const triage = Object.fromEntries(
      body.signals.map((signal) => {
        const baseline = body.triage[signal.id]
        const aiResult = parsed.triage.find((item) => item.signalId === signal.id)

        if (!baseline || !aiResult) {
          return [
            signal.id,
            markTriageFallback(
              baseline,
              'The AI response was incomplete, so the deterministic baseline was used for this signal.',
            ),
          ]
        }

        return [
          signal.id,
          applyAiTriageResult(signal, body.tasks, baseline, aiResult),
        ]
      }),
    )

    return NextResponse.json({ triage, mode: 'ai' as const, usage })
  } catch {
    return buildFallbackResponse(
      body,
      'The AI request failed, so the deterministic baseline was used.',
    )
  }
}
