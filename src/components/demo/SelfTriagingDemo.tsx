'use client'

import {
  Transition,
} from '@headlessui/react'
import {
  BoltIcon,
  CheckCircleIcon,
  ChevronDownIcon,
  Cog6ToothIcon,
  CpuChipIcon,
  EyeIcon,
  FlagIcon,
  MinusCircleIcon,
  PlayIcon,
  ScaleIcon,
} from '@heroicons/react/20/solid'
import { PencilSquareIcon, XMarkIcon } from '@heroicons/react/24/outline'
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'

import Badge from '@/components/Badge'
import {
  buildTriageContextKey,
  deriveActionForSignal,
  evaluateTaskPassDecision,
  evaluateTasks,
  markTriageFallback,
  mergeActionEntries,
  simulatePseudoAiTriage,
  type TaskPassDecision,
} from '@/components/demo/demoLogic'
import {
  baseDemoSnapshot,
  cloneSnapshot,
  findTaskById,
  getFirstSignalId,
  type ActionType,
  type DemoAction,
  type DemoSnapshot,
  type DemoTask,
  type DemoSignal,
  type DemoTriage,
  type GuardrailStatus,
  type Severity,
  type TriageDecision,
  type TaskStatus,
  taskStatusOrder,
  weirdDemoSnapshot,
} from '@/components/demo/demoData'

const statusLabels: Record<TaskStatus, string> = {
  backlog: 'Backlog',
  in_progress: 'In Progress',
  done: 'Done',
}

const statusPanelClasses: Record<TaskStatus, string> = {
  backlog:
    'border-zinc-200/65 bg-white dark:border-zinc-700/35 dark:bg-zinc-900/60',
  in_progress:
    'border-blue-200/65 bg-blue-50/70 dark:border-blue-500/20 dark:bg-blue-500/10',
  done: 'border-teal-200/65 bg-teal-50/60 dark:border-teal-500/20 dark:bg-teal-500/10',
}

const statusBadgeColor: Record<
  TaskStatus,
  React.ComponentProps<typeof Badge>['color']
> = {
  backlog: 'gray',
  in_progress: 'blue',
  done: 'softTeal',
}

const signalBadgeColor: Record<
  DemoSignal['kind'],
  React.ComponentProps<typeof Badge>['color']
> = {
  task_overdue: 'yellow',
  missing_owner: 'red',
  duplicate_task: 'purple',
  stuck_in_progress: 'blue',
  noise_alert: 'gray',
  known_issue: 'gray',
  fix_ready: 'softTeal',
}

const severityBadgeColor: Record<
  Severity,
  React.ComponentProps<typeof Badge>['color']
> = {
  low: 'gray',
  medium: 'yellow',
  high: 'pink',
  critical: 'red',
}

const actionBadgeColor: Record<
  ActionType,
  React.ComponentProps<typeof Badge>['color']
> = {
  ignored: 'gray',
  monitored: 'blue',
  escalated: 'pink',
  'auto-fixed': 'green',
}

const decisionLabel: Record<TriageDecision, string> = {
  ignore: 'Ignore',
  monitor: 'Monitor',
  escalate: 'Escalate',
  auto_fix: 'Auto-fix',
}

const triageSourceBadgeColor: Record<
  NonNullable<DemoTriage['source']>,
  React.ComponentProps<typeof Badge>['color']
> = {
  deterministic: 'gray',
  ai: 'softTeal',
  fallback: 'yellow',
}

const triageSourceLabel: Record<NonNullable<DemoTriage['source']>, string> = {
  deterministic: 'Rules-based decision',
  ai: 'Model-assisted decision',
  fallback: 'Rules fallback',
}

const guardrailBadgeColor: Record<
  GuardrailStatus,
  React.ComponentProps<typeof Badge>['color']
> = {
  allowed: 'green',
  blocked: 'red',
  not_needed: 'gray',
}

const guardrailLabel: Record<GuardrailStatus, string> = {
  allowed: 'Applied',
  blocked: 'Blocked',
  not_needed: 'No change',
}

const decisionToActionType: Record<TriageDecision, ActionType> = {
  ignore: 'ignored',
  monitor: 'monitored',
  escalate: 'escalated',
  auto_fix: 'auto-fixed',
}
const decisionToFocusTone: Record<
  TriageDecision,
  'neutral' | 'escalate' | 'monitor' | 'stable'
> = {
  ignore: 'neutral',
  monitor: 'monitor',
  escalate: 'escalate',
  auto_fix: 'stable',
}

const MAX_AI_CALLS_PER_SESSION = 8
const TRIAGE_MODE: 'ai' | 'pseudo' = 'ai'
const ENABLE_FULL_AUDIT_MODE = false
const HEALTHY_TASK_PREVIEW_LIMIT = 10

type AiUsageSummary = {
  aiCalls: number
  cacheHits: number
  fallbacks: number
  inputTokens: number
  outputTokens: number
  totalTokens: number
}

type TimelineEventType =
  | 'monitoring'
  | 'signal'
  | 'evaluating'
  | 'decision'
  | 'action'
  | 'complete'

type TimelineDecisionSummary = {
  classification: 'intervene' | 'watch' | 'benign'
  reasoning: string
  confidence?: number
  source: DemoTriage['source']
  reviewSummary?: string
}

type TimelineCompletionSummary = {
  escalatedCount: number
  monitoredCount: number
  healthyCount: number
  healthyTaskTitles: string[]
  healthyOverflowCount: number
}

type TimelineEvent = {
  id: string
  type: TimelineEventType
  role: 'frame' | 'incident' | 'summary'
  title: string
  description: string
  timestamp: number
  sequence: number
  taskId?: string
  signalId?: string
  decisionTone?: TaskPassDecision['tone']
  decision?: TaskPassDecision
  previousTask?: DemoTask
  before?: TaskStateSnapshot
  after?: TaskStateSnapshot
  eventTriage?: Pick<
    DemoTriage,
    'suggestedRemediation' | 'guardrailStatus' | 'guardrailReason'
  >
  eventAction?: Pick<DemoAction, 'type' | 'message' | 'timestamp'>
  eventDecision?: TimelineDecisionSummary
  completionSummary?: TimelineCompletionSummary
}

let timelineEventSequence = 0
type TaskStateSnapshot = {
  status: string
  owner?: string | null
  priority?: string
  tags?: string[]
}
type NarrativeHeader = {
  title: string
  subtitle: string
}
type TaskFocusTone = 'neutral' | 'escalate' | 'monitor' | 'stable'
type BoardRevealQueue = Partial<Record<TaskStatus, string[]>>
type ActiveTaskPhase =
  | 'scan'
  | 'signal'
  | 'ai_review'
  | 'evaluating'
  | 'decision'
  | 'action_issue'
  | 'action_pass'

const emptyUsageSummary: AiUsageSummary = {
  aiCalls: 0,
  cacheHits: 0,
  fallbacks: 0,
  inputTokens: 0,
  outputTokens: 0,
  totalTokens: 0,
}

const SCAN_DELAY_MS = 420
const BASELINE_DELAY_MS = 900
const EVALUATION_DELAY_MS = 450
const INCIDENT_STAGGER_MIN_MS = 280
const INCIDENT_STAGGER_MAX_MS = 520
const DECISION_STAGGER_MS = 850
const ACTION_STAGGER_MS = 850
const BOARD_REVEAL_BEFORE_SIGNAL_MS = 180
const BOARD_REVEAL_BEFORE_EVALUATION_MS = 220
const TIMELINE_PULSE_MS = 750
const INCIDENT_BURST_MIN = 5
const INCIDENT_BURST_MAX = 7
const basePillClass =
  'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium'
const subtlePillClass = 'inline-flex items-center rounded-full px-2 text-xs'
const narrativeCopy = {
  monitoring: {
    headerTitle: 'Monitors active...',
    headerSubtitle: 'Watching for regressions, drift, and noisy alerts',
    entryTitle: 'Monitors active...',
    entryDetail: 'All monitored paths are within expected bounds.',
  },
  signal: {
    title: 'Monitor fired',
  },
  evaluating: {
    headerTitle: 'Investigating alert...',
    headerSubtitle: 'Reproducing the issue, checking scope, and filtering noise',
    entryTitle: 'Investigating alert...',
    entryDetail: 'Reproducing the issue, checking scope, and filtering noise',
  },
  decision: {
    escalate: 'Decision: Needs intervention',
    monitor: 'Decision: Keep watching',
    stable: 'Decision: Benign',
  },
  action: {
    noChange: 'Outcome: No action',
    escalated: 'Outcome: Escalated',
    updated: 'Outcome: Monitor updated',
  },
  complete: {
    headerTitle: 'Sweep complete',
    emptySummary: 'No alerts required intervention',
  },
} as const

function buildDerivedSnapshot(
  snapshot: DemoSnapshot,
  passLabel: string,
): DemoSnapshot {
  const derived = evaluateTasks(snapshot.tasks, passLabel)

  return {
    ...snapshot,
    ...derived,
  }
}

function buildBoardRevealQueue(tasks: DemoTask[]) {
  return tasks.reduce<BoardRevealQueue>((queue, task) => {
    const current = queue[task.status] ?? []
    queue[task.status] = [...current, task.id]
    return queue
  }, {})
}

function selectFirstSignalForTask(nextSnapshot: DemoSnapshot, taskId: string) {
  return (
    nextSnapshot.signals.find((signal) => signal.taskId === taskId)?.id ??
    nextSnapshot.signals[0]?.id ??
    ''
  )
}

function shuffleItems<T>(items: T[]) {
  const nextItems = [...items]

  for (let index = nextItems.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1))
    ;[nextItems[index], nextItems[swapIndex]] = [
      nextItems[swapIndex],
      nextItems[index],
    ]
  }

  return nextItems
}

function randomBetween(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

function applyRandomIncidents(
  tasks: DemoTask[],
  options?: { minIncidents?: number; maxIncidents?: number },
) {
  type IncidentType =
    | 'missing_owner'
    | 'task_overdue'
    | 'stuck_in_progress'
    | 'duplicate_task'
    | 'noise_alert'
    | 'known_issue'
    | 'fix_ready'
  const nextTasks = tasks.map((task) => ({ ...task }))
  const incidentMessages: string[] = []
  const incidentEvents: Array<{ message: string; taskId: string }> = []
  const randomTask = (
    predicate: (task: DemoTask) => boolean,
    excludedIds = new Set<string>(),
  ) => {
    const candidates = nextTasks.filter(
      (task) => predicate(task) && !excludedIds.has(task.id),
    )

    if (candidates.length === 0) {
      return null
    }

    return candidates[Math.floor(Math.random() * candidates.length)]
  }

  const usedTaskIds = new Set<string>()
  const minIncidents = options?.minIncidents ?? 1
  const maxIncidents = options?.maxIncidents ?? 3
  const incidentCount = randomBetween(minIncidents, maxIncidents)
  const weightedIncidentPool: IncidentType[] = [
    'missing_owner',
    'missing_owner',
    'task_overdue',
    'task_overdue',
    'stuck_in_progress',
    'stuck_in_progress',
    'duplicate_task',
    'noise_alert',
    'noise_alert',
    'known_issue',
    'fix_ready',
    'fix_ready',
  ]
  const incidentTypes: IncidentType[] = []

  for (const incidentType of shuffleItems(weightedIncidentPool)) {
    if (incidentTypes.includes(incidentType)) {
      continue
    }

    incidentTypes.push(incidentType)

    if (incidentTypes.length >= incidentCount) {
      break
    }
  }

  for (const incidentType of incidentTypes) {
    if (incidentType === 'missing_owner') {
      const target =
        randomTask(
          (task) => task.status !== 'done' && task.owner !== null,
          usedTaskIds,
        ) ?? randomTask((task) => task.status !== 'done', usedTaskIds)

      if (!target) continue
      target.owner = null
      if (
        Math.random() < 0.45 &&
        (target.priority === 'P2' || target.priority === 'P3')
      ) {
        target.priority = Math.random() < 0.5 ? 'P1' : 'P0'
      }
      target.ageLabel = 'Owner dropped just now'
      usedTaskIds.add(target.id)
      const message =
        target.priority === 'P0'
          ? `Overdue task with no assigned owner: ${target.title}`
          : `Task has no assigned owner: ${target.title}`
      incidentMessages.push(message)
      incidentEvents.push({ message, taskId: target.id })
      continue
    }

    if (incidentType === 'task_overdue') {
      const target =
        randomTask(
          (task) => task.status !== 'done' && task.dueInDays !== null,
          usedTaskIds,
        ) ?? randomTask((task) => task.status !== 'done', usedTaskIds)

      if (!target) continue
      target.dueInDays = -1 - Math.floor(Math.random() * 4)
      target.daysInStatus = Math.max(
        target.daysInStatus,
        8 + Math.floor(Math.random() * 4),
      )
      if (
        Math.random() < 0.5 &&
        (target.priority === 'P2' || target.priority === 'P3')
      ) {
        target.priority = 'P0'
      }
      target.ageLabel = 'Overdue just now'
      usedTaskIds.add(target.id)
      const message = `Overdue task identified: ${target.title}`
      incidentMessages.push(message)
      incidentEvents.push({ message, taskId: target.id })
      continue
    }

    if (incidentType === 'stuck_in_progress') {
      const target =
        randomTask((task) => task.status === 'in_progress', usedTaskIds) ??
        randomTask((task) => task.status !== 'done', usedTaskIds)

      if (!target) continue
      target.status = 'in_progress'
      target.daysInStatus = Math.max(
        target.daysInStatus,
        10 + Math.floor(Math.random() * 4),
      )
      if (Math.random() < 0.55 && target.priority !== 'P0') {
        target.priority = 'P1'
      }
      target.ageLabel = `${target.daysInStatus}d active`
      usedTaskIds.add(target.id)
      const message = `Task active for ${target.daysInStatus} days without progress: ${target.title}`
      incidentMessages.push(message)
      incidentEvents.push({ message, taskId: target.id })
      continue
    }

    if (incidentType === 'noise_alert') {
      const target =
        randomTask(
          (task) =>
            task.status !== 'done' &&
            task.monitorDisposition === 'normal' &&
            task.kind === 'monitoring',
          usedTaskIds,
        ) ?? randomTask((task) => task.status !== 'done', usedTaskIds)

      if (!target) continue
      target.monitorDisposition = 'noise'
      target.ageLabel = 'Threshold drift detected'
      usedTaskIds.add(target.id)
      const message = `Monitor looks noisy under routine traffic: ${target.title}`
      incidentMessages.push(message)
      incidentEvents.push({ message, taskId: target.id })
      continue
    }

    if (incidentType === 'known_issue') {
      const target =
        randomTask(
          (task) =>
            task.status !== 'done' &&
            task.monitorDisposition === 'normal' &&
            task.kind !== 'content',
          usedTaskIds,
        ) ?? randomTask((task) => task.status !== 'done', usedTaskIds)

      if (!target) continue
      target.monitorDisposition = 'known_issue'
      target.ageLabel = 'Existing fix linked'
      usedTaskIds.add(target.id)
      const message = `Known issue already linked to monitor: ${target.title}`
      incidentMessages.push(message)
      incidentEvents.push({ message, taskId: target.id })
      continue
    }

    if (incidentType === 'fix_ready') {
      const target =
        randomTask(
          (task) =>
            task.status !== 'done' &&
            task.monitorDisposition === 'normal' &&
            (task.kind === 'latency' || task.kind === 'error_rate'),
          usedTaskIds,
        ) ?? randomTask((task) => task.status !== 'done', usedTaskIds)

      if (!target) continue
      target.monitorDisposition = 'fix_ready'
      target.priority = target.priority === 'P3' ? 'P2' : target.priority
      target.ageLabel = 'Reproduced just now'
      usedTaskIds.add(target.id)
      const message = `Reproduction succeeded with a fix proposal: ${target.title}`
      incidentMessages.push(message)
      incidentEvents.push({ message, taskId: target.id })
      continue
    }

    const source =
      randomTask((task) => task.status !== 'done') ??
      nextTasks.find((task) => task.status !== 'done') ??
      null
    const duplicateTarget =
      randomTask(
        (task) => task.status !== 'done' && task.id !== source?.id,
        usedTaskIds,
      ) ??
      randomTask((task) => task.status !== 'done' && task.id !== source?.id) ??
      null

    if (!source || !duplicateTarget) {
      continue
    }

    duplicateTarget.title = source.title
    duplicateTarget.ageLabel = 'Duplicate surfaced just now'
    usedTaskIds.add(duplicateTarget.id)
    const message = `Duplicate task identified in backlog: ${source.title}`
    incidentMessages.push(message)
    incidentEvents.push({ message, taskId: source.id })
  }

  return {
    tasks: nextTasks,
    incidentCount: Math.min(incidentTypes.length, incidentCount),
    incidentMessages,
    incidentEvents,
  }
}

function buildPseudoSelectionTriage(
  snapshot: DemoSnapshot,
  signalId: string,
): Record<string, DemoTriage> {
  const signal = snapshot.signals.find((item) => item.id === signalId)

  if (!signal) {
    return {}
  }

  const baseline = snapshot.triage[signal.id]

  if (!baseline) {
    return {}
  }

  return {
    [signal.id]: simulatePseudoAiTriage(signal, snapshot.tasks, baseline),
  }
}

function isUsageSummaryEmpty(usageSummary: AiUsageSummary) {
  return (
    usageSummary.aiCalls === 0 &&
    usageSummary.cacheHits === 0 &&
    usageSummary.fallbacks === 0 &&
    usageSummary.inputTokens === 0 &&
    usageSummary.outputTokens === 0 &&
    usageSummary.totalTokens === 0
  )
}

function wait(ms: number) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms)
  })
}

function DemoBadge({
  color,
  children,
}: {
  color?: React.ComponentProps<typeof Badge>['color']
  children: React.ReactNode
}) {
  return (
    <Badge color={color} customStyles={subtlePillClass}>
      {children}
    </Badge>
  )
}

function buildActivityEvidence(task: DemoTask) {
  const evidence = new Set<string>()

  if (task.dueInDays !== null && task.dueInDays < 0) {
    evidence.add('Overdue')
  }

  if (task.daysInStatus > 0) {
    evidence.add(`${task.daysInStatus} days stale`)
  }

  if (!task.owner) {
    evidence.add('No owner')
  }

  evidence.add(`Priority ${task.priority}`)

  if (task.status === 'backlog') {
    evidence.add('Queued in backlog')
  }

  if (task.status === 'in_progress') {
    evidence.add(`In progress ${task.daysInStatus} days`)
  }

  if (task.status === 'done') {
    evidence.add('Completed today')
  }

  if (task.attentionState === 'needs_attention') {
    evidence.add('Needs attention')
  }

  if (task.attentionState === 'watch') {
    evidence.add('Watch list')
  }

  return [...evidence]
}

function getEvidencePillClass(evidenceItem: string) {
  if (evidenceItem === 'Overdue' || evidenceItem.includes('days stale')) {
    return 'border-yellow-300/55 bg-yellow-50 text-yellow-700 dark:border-yellow-500/18 dark:bg-yellow-500/10 dark:text-yellow-300'
  }

  if (evidenceItem === 'No owner') {
    return 'border-amber-300/55 bg-amber-50 text-amber-700 dark:border-amber-500/18 dark:bg-amber-500/10 dark:text-amber-300'
  }

  if (
    evidenceItem.includes('Priority P0') ||
    evidenceItem.includes('Priority P1')
  ) {
    return 'border-rose-300/55 bg-rose-50 text-rose-700 dark:border-rose-500/18 dark:bg-rose-500/10 dark:text-rose-300'
  }

  if (evidenceItem.includes('Priority')) {
    return 'border-blue-300/55 bg-blue-50 text-blue-700 dark:border-blue-500/18 dark:bg-blue-500/10 dark:text-blue-300'
  }

  if (
    evidenceItem.includes('In progress') ||
    evidenceItem.includes('Queued in backlog')
  ) {
    return 'border-indigo-300/55 bg-indigo-50 text-indigo-700 dark:border-indigo-500/18 dark:bg-indigo-500/10 dark:text-indigo-300'
  }

  if (evidenceItem === 'Completed today') {
    return 'border-green-300/55 bg-green-50 text-green-700 dark:border-green-500/18 dark:bg-green-500/10 dark:text-green-300'
  }

  if (evidenceItem === 'Needs attention') {
    return 'border-red-300/55 bg-red-50 text-red-700 dark:border-red-500/18 dark:bg-red-500/10 dark:text-red-300'
  }

  if (evidenceItem === 'Watch list') {
    return 'border-yellow-300/55 bg-yellow-50 text-yellow-700 dark:border-yellow-500/18 dark:bg-yellow-500/10 dark:text-yellow-300'
  }

  return 'border-zinc-200/65 bg-zinc-100 text-zinc-600 dark:border-zinc-700/35 dark:bg-zinc-900 dark:text-zinc-300'
}

function buildActivityOutcome(
  decision: TaskPassDecision,
  previousTask: DemoTask,
) {
  if (
    decision.changed &&
    decision.nextTask.attentionState !== previousTask.attentionState
  ) {
    if (decision.nextTask.attentionState === 'needs_attention') {
      return 'Marked as needs attention'
    }

    if (decision.nextTask.attentionState === 'watch') {
      return 'Added to watch list'
    }

    return 'Attention state cleared'
  }

  if (decision.changed && decision.nextTask.status !== previousTask.status) {
    const nextStatusLabel =
      decision.nextTask.status === 'in_progress'
        ? 'In Progress'
        : decision.nextTask.status.charAt(0).toUpperCase() +
          decision.nextTask.status.slice(1)

    return `Moved to ${nextStatusLabel}`
  }

  if (decision.tone === 'monitor') {
    return 'Flagged for monitoring'
  }

  if (decision.tone === 'stable') {
    return decision.nextTask.status === 'done' ? 'No action' : 'State validated'
  }

  return 'State validated'
}

type TaskInsightContext = {
  task: DemoTask | null
  signals: DemoSignal[]
  primarySignal: DemoSignal | null
  primaryTriage: DemoTriage | null
  primaryAction: DemoAction | null
  isAiPending: boolean
}

function buildTaskInsightContext({
  snapshot,
  effectiveTriage,
  aiPendingSignalIds,
  selectedSignalId,
  taskId,
}: {
  snapshot: DemoSnapshot
  effectiveTriage: Record<string, DemoTriage>
  aiPendingSignalIds: string[]
  selectedSignalId: string
  taskId: string
}): TaskInsightContext {
  const task = findTaskById(snapshot, taskId)
  const signals = snapshot.signals.filter(
    (signal) =>
      signal.taskId === taskId ||
      (signal.relatedTaskIds ?? []).includes(taskId),
  )
  const primarySignal =
    signals.find((signal) => signal.id === selectedSignalId) ??
    signals[0] ??
    null
  const primaryTriage = primarySignal ? effectiveTriage[primarySignal.id] : null
  const primaryAction = primarySignal
    ? (snapshot.actions.find(
        (action) => action.signalId === primarySignal.id,
      ) ?? null)
    : null

  return {
    task,
    signals,
    primarySignal,
    primaryTriage,
    primaryAction,
    isAiPending: primarySignal
      ? aiPendingSignalIds.includes(primarySignal.id)
      : false,
  }
}

function buildSignalSummary(insightContext: TaskInsightContext) {
  if (insightContext.signals.length === 0) {
    return 'No signals detected'
  }

  return (
    insightContext.primarySignal?.title ??
    insightContext.signals[0]?.title ??
    'Signal detected'
  )
}

function buildDecisionSummary(insightContext: TaskInsightContext) {
  if (!insightContext.primaryTriage) {
    return 'No decision recorded yet'
  }

  return `${decisionLabel[insightContext.primaryTriage.decision]} because ${insightContext.primaryTriage.reasoning}`
}

function buildActionSummary(insightContext: TaskInsightContext) {
  if (insightContext.primaryAction) {
    return insightContext.primaryAction.message
  }

  if (insightContext.primaryTriage?.guardrailReason) {
    return insightContext.primaryTriage.guardrailReason
  }

  return 'No change was applied'
}

function buildTimelineEvent(
  type: TimelineEventType,
  title: string,
  description: string,
  options?: {
    taskId?: string
    signalId?: string
    decisionTone?: TaskPassDecision['tone']
    decision?: TaskPassDecision
    previousTask?: DemoTask
    before?: TaskStateSnapshot
    after?: TaskStateSnapshot
    eventTriage?: Pick<
      DemoTriage,
      'suggestedRemediation' | 'guardrailStatus' | 'guardrailReason'
    >
    eventAction?: Pick<DemoAction, 'type' | 'message' | 'timestamp'>
    eventDecision?: TimelineDecisionSummary
    completionSummary?: TimelineCompletionSummary
  },
): TimelineEvent {
  const role =
    type === 'monitoring'
      ? 'frame'
      : type === 'complete'
        ? 'summary'
        : 'incident'

  return {
    id: `narrative-${type}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    type,
    role,
    title,
    description,
    timestamp: Date.now(),
    sequence: ++timelineEventSequence,
    taskId: options?.taskId,
    signalId: options?.signalId,
    decisionTone: options?.decisionTone,
    decision: options?.decision,
    previousTask: options?.previousTask,
    before: options?.before,
    after: options?.after,
    eventTriage: options?.eventTriage,
    eventAction: options?.eventAction,
    eventDecision: options?.eventDecision,
    completionSummary: options?.completionSummary,
  }
}

function captureTaskStateSnapshot(task: DemoTask): TaskStateSnapshot {
  return {
    status: statusLabels[task.status],
    owner: task.owner,
    priority: task.priority,
  }
}

function projectTaskStateSnapshotForAction(
  task: DemoTask,
  actionType: DemoAction['type'],
): TaskStateSnapshot {
  const snapshot = captureTaskStateSnapshot(task)

  if (actionType === 'escalated') {
    return {
      ...snapshot,
      tags: ['Needs attention', 'Manual review'],
    }
  }

  if (actionType === 'monitored') {
    return {
      ...snapshot,
      tags: ['Watch list'],
    }
  }

  if (actionType === 'auto-fixed') {
    return {
      ...snapshot,
      tags: ['Fallback applied'],
    }
  }

  return snapshot
}

function getChangedTaskSnapshotFields(
  before: TaskStateSnapshot,
  after: TaskStateSnapshot,
) {
  return (Object.keys(after) as Array<keyof TaskStateSnapshot>).filter(
    (key) => {
      const beforeValue = before[key]
      const afterValue = after[key]

      if (Array.isArray(beforeValue) || Array.isArray(afterValue)) {
        return (
          JSON.stringify(beforeValue ?? []) !== JSON.stringify(afterValue ?? [])
        )
      }

      return beforeValue !== afterValue
    },
  )
}

function getVisibleTaskSnapshotFields(
  before: TaskStateSnapshot,
  after: TaskStateSnapshot,
) {
  const changedFields = getChangedTaskSnapshotFields(before, after)
  const fields = new Set<keyof TaskStateSnapshot>(['status', 'owner'])

  for (const field of changedFields) {
    fields.add(field)
  }

  return (
    ['status', 'owner', 'priority', 'tags'] as Array<keyof TaskStateSnapshot>
  )
    .filter((field) => fields.has(field))
    .slice(0, 5)
}

function formatTaskSnapshotFieldLabel(field: keyof TaskStateSnapshot) {
  if (field === 'status') {
    return 'Status'
  }

  if (field === 'owner') {
    return 'Owner'
  }

  if (field === 'priority') {
    return 'Priority'
  }

  return 'Tags'
}

function formatTaskSnapshotFieldValue(
  value: TaskStateSnapshot[keyof TaskStateSnapshot],
) {
  if (Array.isArray(value)) {
    return value.length > 0 ? value.join(', ') : 'None'
  }

  if (value === null || value === undefined || value === '') {
    return 'None'
  }

  return String(value)
}

function buildDecisionNarrativeLabel(decision: TaskPassDecision) {
  if (decision.tone === 'escalate') {
    return narrativeCopy.decision.escalate
  }

  if (decision.tone === 'monitor') {
    return narrativeCopy.decision.monitor
  }

  return narrativeCopy.decision.stable
}

function mapDecisionClassification(
  tone: TaskPassDecision['tone'],
): TimelineDecisionSummary['classification'] {
  if (tone === 'escalate') {
    return 'intervene'
  }

  if (tone === 'monitor') {
    return 'watch'
  }

  return 'benign'
}

function buildAiReviewDetail(signal: DemoSignal) {
  return `${signal.title} was assessed against recent actions, current task context, and safe remediation paths.`
}

function buildEvaluatingTaskDetail(decision: TaskPassDecision) {
  return decision.reasoning
}

function buildDecisionEventSummary(
  decision: TaskPassDecision,
  triage: DemoTriage | null,
  signal: DemoSignal | null,
): TimelineDecisionSummary {
  return {
    classification: mapDecisionClassification(decision.tone),
    reasoning: triage?.reasoning ?? buildEvaluatingTaskDetail(decision),
    confidence: triage?.confidence,
    source: triage?.source ?? 'deterministic',
    reviewSummary: signal ? buildAiReviewDetail(signal) : undefined,
  }
}

function getDecisionConfidenceLabel(confidence?: number) {
  if (typeof confidence !== 'number') {
    return null
  }

  if (confidence < 0.67) {
    return 'Low confidence'
  }

  if (confidence < 0.85) {
    return 'Moderate confidence'
  }

  return 'High confidence'
}

function buildActionNarrativeLabel(
  decision: TaskPassDecision,
  previousTask: DemoTask,
) {
  if (previousTask.monitorDisposition === 'known_issue') {
    return 'Outcome: Stand down'
  }

  if (decision.nextTask.monitorDisposition === 'fix_ready') {
    return 'Outcome: Fix proposed'
  }

  if (decision.nextTask.monitorDisposition === 'noise') {
    return 'Outcome: Monitor tuned'
  }

  const outcome = buildActivityOutcome(decision, previousTask)

  if (outcome === 'No action' || outcome === 'State validated') {
    return narrativeCopy.action.noChange
  }

  if (outcome.includes('Needs attention') || decision.tone === 'escalate') {
    return narrativeCopy.action.escalated
  }

  return narrativeCopy.action.updated
}

function buildActionNarrativeDetail(
  decision: TaskPassDecision,
  previousTask: DemoTask,
) {
  if (previousTask.monitorDisposition === 'known_issue') {
    return `${decision.nextTask.title} was suppressed because an existing fix already covers this alert`
  }

  if (decision.nextTask.monitorDisposition === 'fix_ready') {
    return `${decision.nextTask.title} now has a bounded fix proposal ready for engineer review`
  }

  if (decision.nextTask.monitorDisposition === 'noise') {
    return `${decision.nextTask.title} was marked for threshold tuning instead of engineer escalation`
  }

  const outcome = buildActivityOutcome(decision, previousTask)

  if (outcome === 'No action' || outcome === 'State validated') {
    return `${decision.nextTask.title} remained unchanged after investigation`
  }

  if (decision.nextTask.attentionState === 'needs_attention') {
    return `${decision.nextTask.title} was routed for review after the alert was confirmed`
  }

  return `${decision.nextTask.title} was updated after investigation`
}

function deriveTimelineActionType(
  decision: TaskPassDecision,
  previousTask: DemoTask,
): DemoAction['type'] {
  if (previousTask.monitorDisposition === 'known_issue') {
    return 'ignored'
  }

  if (decision.nextTask.monitorDisposition === 'fix_ready') {
    return 'escalated'
  }

  if (decision.nextTask.monitorDisposition === 'noise') {
    return 'monitored'
  }

  const actionLabel = buildActionNarrativeLabel(decision, previousTask)

  if (actionLabel === narrativeCopy.action.escalated) {
    return 'escalated'
  }

  if (actionLabel === narrativeCopy.action.updated) {
    return 'monitored'
  }

  return 'ignored'
}

function buildCompletionSummary(
  decisions: TaskPassDecision[],
  healthyTaskTitles: string[],
): TimelineCompletionSummary {
  const escalatedCount = decisions.filter(
    (decision) => decision.tone === 'escalate',
  ).length
  const monitoredCount = decisions.filter(
    (decision) => decision.tone === 'monitor',
  ).length
  const healthyCount = healthyTaskTitles.length

  return {
    escalatedCount,
    monitoredCount,
    healthyCount,
    healthyTaskTitles: healthyTaskTitles.slice(0, HEALTHY_TASK_PREVIEW_LIMIT),
    healthyOverflowCount: Math.max(
      healthyTaskTitles.length - HEALTHY_TASK_PREVIEW_LIMIT,
      0,
    ),
  }
}

function summarizeCompletion(summary: TimelineCompletionSummary) {
  const parts: string[] = []

  if (summary.escalatedCount > 0) {
    parts.push(
      `${summary.escalatedCount} alert${summary.escalatedCount === 1 ? '' : 's'} escalated`,
    )
  }

  if (summary.monitoredCount > 0) {
    parts.push(
      `${summary.monitoredCount} alert${summary.monitoredCount === 1 ? '' : 's'} kept under watch`,
    )
  }

  parts.push(
    `${summary.healthyCount} task${summary.healthyCount === 1 ? '' : 's'} within expected bounds`,
  )

  return parts.join(', ')
}

function buildNarrativeHeader(phase: 'monitoring' | 'evaluating' | 'complete') {
  if (phase === 'monitoring') {
    return {
      title: narrativeCopy.monitoring.headerTitle,
      subtitle: narrativeCopy.monitoring.headerSubtitle,
    }
  }

  if (phase === 'evaluating') {
    return {
      title: narrativeCopy.evaluating.headerTitle,
      subtitle: narrativeCopy.evaluating.headerSubtitle,
    }
  }

  return {
    title: narrativeCopy.complete.headerTitle,
    subtitle: narrativeCopy.complete.emptySummary,
  }
}

function buildSignalNarrativeContent(message: string) {
  const stuckMatch = message.match(
    /^Task active for (\d+) days without progress: (.+)$/,
  )

  if (stuckMatch) {
    const [, days, taskTitle] = stuckMatch

    return {
      title: 'Execution stalled',
      description: `${taskTitle} has been active for ${days} days without progress.`,
    }
  }

  const overdueMatch = message.match(/^Overdue task identified: (.+)$/)

  if (overdueMatch) {
    const [, taskTitle] = overdueMatch

    return {
      title: 'Expected window breached',
      description: `${taskTitle} is now overdue and needs review.`,
    }
  }

  const missingOwnerMatch = message.match(
    /^Overdue task with no assigned owner: (.+)$/,
  )

  if (missingOwnerMatch) {
    const [, taskTitle] = missingOwnerMatch

    return {
      title: 'Unowned overdue work',
      description: `${taskTitle} is overdue and currently has no owner.`,
    }
  }

  const ownerMatch = message.match(/^Task has no assigned owner: (.+)$/)

  if (ownerMatch) {
    const [, taskTitle] = ownerMatch

    return {
      title: 'Ownership gap',
      description: `${taskTitle} is active without an assigned owner.`,
    }
  }

  const duplicateMatch = message.match(/^Duplicate task identified in backlog: (.+)$/)

  if (duplicateMatch) {
    const [, taskTitle] = duplicateMatch

    return {
      title: 'Duplicate work detected',
      description: `${taskTitle} appears more than once in active work.`,
    }
  }

  const noiseMatch = message.match(/^Monitor looks noisy under routine traffic: (.+)$/)

  if (noiseMatch) {
    const [, taskTitle] = noiseMatch

    return {
      title: 'Alert noise detected',
      description: `${taskTitle} is firing on routine traffic and should be tuned before it pages again.`,
    }
  }

  const knownIssueMatch = message.match(
    /^Known issue already linked to monitor: (.+)$/,
  )

  if (knownIssueMatch) {
    const [, taskTitle] = knownIssueMatch

    return {
      title: 'Existing incident resurfaced',
      description: `${taskTitle} overlaps with a tracked issue and should be checked before opening a new response.`,
    }
  }

  const fixReadyMatch = message.match(
    /^Reproduction succeeded with a fix proposal: (.+)$/,
  )

  if (fixReadyMatch) {
    const [, taskTitle] = fixReadyMatch

    return {
      title: 'Issue reproduced',
      description: `${taskTitle} reproduced reliably in the current workflow and is ready for classification.`,
    }
  }

  return {
    title: narrativeCopy.signal.title,
    description: message,
  }
}

function buildSignalNarrativeEntry(message: string) {
  const narrative = buildSignalNarrativeContent(message)

  return buildTimelineEvent('signal', narrative.title, narrative.description)
}

function buildMonitoringNarrativeEntry() {
  return buildTimelineEvent(
    'monitoring',
    narrativeCopy.monitoring.entryTitle,
    narrativeCopy.monitoring.entryDetail,
  )
}

function buildPassedScanNarrative(task: DemoTask) {
  return buildTimelineEvent(
    'action',
    'No issue detected',
    `${task.title} stayed within expected bounds for this sweep.`,
    {
      taskId: task.id,
      decisionTone: 'stable',
      eventAction: {
        type: 'ignored',
        message: `${task.title} did not require intervention during this sweep.`,
        timestamp: 'During this sweep',
      },
    },
  )
}

function buildCompletionNarrativeEntry(summary: TimelineCompletionSummary) {
  return buildTimelineEvent(
    'complete',
    narrativeCopy.complete.headerTitle,
    summarizeCompletion(summary),
    {
      completionSummary: summary,
    },
  )
}

function getDecisionSourceCopy(
  source: DemoTriage['source'],
  isPending = false,
) {
  if (isPending) {
    return 'Waiting on the model response.'
  }

  if (source === 'fallback') {
    return 'A fallback rule supplied this decision.'
  }

  if (source === 'ai') {
    return TRIAGE_MODE === 'pseudo'
      ? 'A local simulated model supplied this decision.'
      : 'A live model contributed to this decision.'
  }

  return 'A deterministic rules layer supplied this decision.'
}

function getActionEventVisualTone(entry: TimelineEvent) {
  if (entry.type !== 'action') {
    return 'neutral' as const
  }

  if (entry.title === 'No issue detected') {
    return 'stable' as const
  }

  const actionType = entry.eventAction?.type

  if (actionType === 'escalated' || entry.decisionTone === 'escalate') {
    return 'escalate' as const
  }

  if (actionType === 'ignored' || entry.title.includes('No change')) {
    return 'neutral' as const
  }

  return 'stable' as const
}

function getTimelineEventVisualTone(entry: TimelineEvent) {
  if (entry.type === 'signal') {
    return 'signal' as const
  }

  if (entry.type === 'evaluating') {
    return 'evaluating' as const
  }

  if (entry.type === 'decision') {
    return 'decision' as const
  }

  if (entry.type === 'action') {
    return getActionEventVisualTone(entry)
  }

  return 'neutral' as const
}

function getTimelineEventGlowClasses(
  entry: TimelineEvent,
  isSelected: boolean,
) {
  if (entry.role === 'frame') {
    return isSelected
      ? 'shadow-[0_0_24px_-12px_rgba(113,113,122,0.18)] dark:shadow-[0_0_28px_-14px_rgba(24,24,27,0.5)]'
      : 'shadow-none'
  }

  if (!isSelected) {
    if (entry.title === 'No issue detected') {
      return 'shadow-[0_0_14px_-14px_rgba(34,197,94,0.18)] dark:shadow-[0_0_18px_-16px_rgba(34,197,94,0.1)]'
    }

    return 'shadow-[0_0_18px_-12px_rgba(15,23,42,0.3)] dark:shadow-[0_0_24px_-14px_rgba(0,0,0,0.65)]'
  }

  const tone = getTimelineEventVisualTone(entry)

  if (tone === 'signal') {
    return 'shadow-[0_0_34px_-10px_rgba(245,158,11,0.38)] dark:shadow-[0_0_38px_-12px_rgba(245,158,11,0.3)]'
  }

  if (tone === 'evaluating') {
    return 'shadow-[0_0_34px_-10px_rgba(59,130,246,0.32)] dark:shadow-[0_0_38px_-12px_rgba(59,130,246,0.26)]'
  }

  if (tone === 'decision') {
    return 'shadow-[0_0_34px_-10px_rgba(99,102,241,0.32)] dark:shadow-[0_0_38px_-12px_rgba(99,102,241,0.26)]'
  }

  if (tone === 'escalate') {
    return 'shadow-[0_0_36px_-10px_rgba(239,68,68,0.34)] dark:shadow-[0_0_40px_-12px_rgba(239,68,68,0.28)]'
  }

  if (tone === 'stable') {
    return 'shadow-[0_0_34px_-10px_rgba(20,184,166,0.3)] dark:shadow-[0_0_38px_-12px_rgba(20,184,166,0.24)]'
  }

  return 'shadow-[0_0_30px_-10px_rgba(113,113,122,0.28)] dark:shadow-[0_0_34px_-12px_rgba(24,24,27,0.62)]'
}

function getTimelineEventToneClasses(
  entry: TimelineEvent,
  isSelected: boolean,
) {
  const base =
    entry.role === 'frame'
      ? isSelected
        ? 'border-zinc-200/80 bg-zinc-50/95 dark:border-zinc-700/35 dark:bg-zinc-950/80'
        : 'border-zinc-200/55 bg-zinc-50/70 dark:border-zinc-800/55 dark:bg-zinc-950/65'
      : entry.type === 'signal'
      ? isSelected
        ? 'border-amber-300/95 bg-white dark:border-amber-400/40 dark:bg-zinc-950'
        : 'border-amber-200/65 bg-white dark:border-amber-500/18 dark:bg-zinc-950'
      : entry.type === 'evaluating'
        ? isSelected
          ? 'border-blue-300/95 bg-white dark:border-blue-400/40 dark:bg-zinc-950'
          : 'border-blue-200/65 bg-white dark:border-blue-500/18 dark:bg-zinc-950'
        : entry.type === 'decision'
          ? isSelected
            ? 'border-indigo-300/95 bg-white dark:border-indigo-400/40 dark:bg-zinc-950'
            : 'border-indigo-200/65 bg-white dark:border-indigo-500/18 dark:bg-zinc-950'
        : entry.type === 'action'
            ? entry.title === 'No issue detected'
            ? isSelected
              ? 'border-green-200/70 bg-white dark:border-green-500/20 dark:bg-zinc-950'
              : 'border-zinc-200/65 bg-white dark:border-zinc-700/25 dark:bg-zinc-950'
            : entry.title === 'No issue detected'
              ? isSelected
                ? 'border-green-200/70 bg-white dark:border-green-500/20 dark:bg-zinc-950'
                : 'border-zinc-200/65 bg-white dark:border-zinc-700/25 dark:bg-zinc-950'
              : getActionEventVisualTone(entry) === 'escalate'
              ? isSelected
                ? 'border-red-300/95 bg-white dark:border-red-400/40 dark:bg-zinc-950'
                : 'border-red-200/65 bg-white dark:border-red-500/18 dark:bg-zinc-950'
              : getActionEventVisualTone(entry) === 'stable'
      ? isSelected
        ? 'border-teal-300/95 bg-white dark:border-teal-400/40 dark:bg-zinc-950'
        : 'border-teal-200/45 bg-white/95 dark:border-teal-500/14 dark:bg-zinc-950'
      : isSelected
        ? 'border-zinc-300/95 bg-white dark:border-zinc-500/45 dark:bg-zinc-950'
        : 'border-zinc-300/75 bg-white dark:border-zinc-500/28 dark:bg-zinc-950'
            : entry.type === 'complete'
              ? isSelected
                ? 'border-zinc-300/95 bg-white dark:border-zinc-500/45 dark:bg-zinc-950'
                : 'border-zinc-300/75 bg-white dark:border-zinc-500/28 dark:bg-zinc-950'
              : isSelected
                ? 'border-zinc-300/95 bg-white dark:border-zinc-500/45 dark:bg-zinc-950'
                : 'border-zinc-200/65 bg-white dark:border-zinc-700/25 dark:bg-zinc-950'

  return `${base} ${getTimelineEventGlowClasses(entry, isSelected)}`
}

function getTimelineEventIcon(entry: TimelineEvent) {
  if (entry.type === 'monitoring') {
    return EyeIcon
  }

  if (entry.type === 'signal') {
    return BoltIcon
  }

  if (entry.type === 'evaluating') {
    return CpuChipIcon
  }

  if (entry.type === 'decision') {
    return ScaleIcon
  }

  if (entry.type === 'action') {
    if (entry.title === 'No issue detected') {
      return CheckCircleIcon
    }

    if (entry.title === 'Outcome: Monitor tuned') {
      return Cog6ToothIcon
    }

    if (entry.title === 'Outcome: Stand down') {
      return MinusCircleIcon
    }

    if (entry.title === 'Outcome: Fix proposed') {
      return PencilSquareIcon
    }

    if (entry.decisionTone === 'escalate') {
      return FlagIcon
    }

    return entry.title.includes('No change') ? MinusCircleIcon : CheckCircleIcon
  }

  return CheckCircleIcon
}

function renderTimelineEventIcon(entry: TimelineEvent) {
  const Icon = getTimelineEventIcon(entry)

  return <Icon className="h-4 w-4" />
}

function getTimelineEventIconClasses(entry: TimelineEvent) {
  if (entry.role === 'frame') {
    return 'bg-zinc-100 text-zinc-600 dark:bg-zinc-900 dark:text-zinc-300'
  }

  if (entry.type === 'signal') {
    return 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300'
  }

  if (entry.type === 'evaluating') {
    return 'bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300'
  }

  if (entry.type === 'decision') {
    return 'bg-indigo-100 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300'
  }

  if (entry.type === 'action') {
    return entry.title === 'No issue detected'
      ? 'bg-green-100/55 text-green-700 dark:bg-green-500/8 dark:text-green-300'
      : entry.title === 'Outcome: Monitor tuned'
        ? 'bg-teal-100 text-teal-700 dark:bg-teal-500/15 dark:text-teal-300'
      : entry.title === 'Outcome: Stand down'
        ? 'bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200'
      : entry.title === 'Outcome: Fix proposed'
        ? 'bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300'
      : getActionEventVisualTone(entry) === 'escalate'
      ? 'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300'
      : getActionEventVisualTone(entry) === 'stable'
        ? 'bg-teal-100 text-teal-700 dark:bg-teal-500/15 dark:text-teal-300'
        : 'bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200'
  }

  if (entry.type === 'complete') {
    return 'bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200'
  }

  return 'bg-zinc-100 text-zinc-600 dark:bg-zinc-900 dark:text-zinc-300'
}

function getTimelineEventFocusTone(entry: TimelineEvent | null): TaskFocusTone {
  if (!entry) {
    return 'neutral'
  }

  if (entry.role !== 'incident') {
    return 'neutral'
  }

  if (entry.type === 'action') {
    if (getActionEventVisualTone(entry) === 'escalate') {
      return 'escalate'
    }

    return getActionEventVisualTone(entry)
  }

  if (entry.type === 'decision' && entry.decisionTone) {
    return entry.decisionTone
  }

  return entry.decisionTone ?? 'neutral'
}

function TimelineEventDetails({
  entry,
  insightContext,
  onSelectSignal,
}: {
  entry: TimelineEvent
  insightContext: TaskInsightContext | null
  onSelectSignal: (signalId: string) => void
}) {
  if (entry.type === 'complete') {
    const summary = entry.completionSummary

    if (!summary) {
      return (
        <div className="border-t border-zinc-200/55 px-4 py-4 text-sm text-zinc-600 dark:border-zinc-800/55 dark:text-zinc-400">
          No sweep summary details are available yet.
        </div>
      )
    }

    return (
      <div className="space-y-3 border-t border-zinc-200/55 px-4 py-4 dark:border-zinc-800/55">
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-xl border border-zinc-200/65 bg-zinc-50/80 p-3 dark:border-zinc-700/25 dark:bg-zinc-900/40">
            <p className="text-[11px] font-medium tracking-wide text-zinc-500 uppercase dark:text-zinc-400">
              Escalated
            </p>
            <p className="mt-1 text-sm font-medium text-zinc-900 dark:text-zinc-100">
              {summary.escalatedCount}
            </p>
          </div>
          <div className="rounded-xl border border-zinc-200/65 bg-zinc-50/80 p-3 dark:border-zinc-700/25 dark:bg-zinc-900/40">
            <p className="text-[11px] font-medium tracking-wide text-zinc-500 uppercase dark:text-zinc-400">
              Under watch
            </p>
            <p className="mt-1 text-sm font-medium text-zinc-900 dark:text-zinc-100">
              {summary.monitoredCount}
            </p>
          </div>
          <div className="rounded-xl border border-zinc-200/65 bg-zinc-50/80 p-3 dark:border-zinc-700/25 dark:bg-zinc-900/40">
            <p className="text-[11px] font-medium tracking-wide text-zinc-500 uppercase dark:text-zinc-400">
              Healthy
            </p>
            <p className="mt-1 text-sm font-medium text-zinc-900 dark:text-zinc-100">
              {summary.healthyCount}
            </p>
          </div>
        </div>
        <div className="rounded-xl border border-zinc-200/65 bg-zinc-50/80 p-3 dark:border-zinc-700/25 dark:bg-zinc-900/40">
          <p className="text-[11px] font-medium tracking-wide text-zinc-500 uppercase dark:text-zinc-400">
            Tasks that passed checks
          </p>
          {summary.healthyTaskTitles.length > 0 ? (
            <div className="mt-2 space-y-2">
              <div className="space-y-1.5">
                {summary.healthyTaskTitles.map((taskTitle) => (
                  <div
                    key={taskTitle}
                    className="rounded-lg border border-zinc-200/60 bg-white/70 px-3 py-2 text-sm text-zinc-700 dark:border-zinc-700/30 dark:bg-zinc-950/40 dark:text-zinc-300"
                  >
                    {taskTitle}
                  </div>
                ))}
              </div>
              {summary.healthyOverflowCount > 0 ? (
                <p className="text-sm text-zinc-600 dark:text-zinc-400">
                  +{summary.healthyOverflowCount} more tasks cleared this sweep.
                </p>
              ) : null}
            </div>
          ) : (
            <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
              No healthy-task detail was recorded for this sweep.
            </p>
          )}
        </div>
      </div>
    )
  }

  if (!insightContext) {
    return (
      <div className="border-t border-zinc-200/55 px-4 py-4 text-sm text-zinc-600 dark:border-zinc-800/55 dark:text-zinc-400">
        No detail is available for this entry.
      </div>
    )
  }

  const {
    task,
    signals,
    primarySignal,
    primaryTriage,
    primaryAction,
    isAiPending,
  } = insightContext
  const displaySignal =
    primarySignal ??
    (entry.signalId
      ? signals.find((signal) => signal.id === entry.signalId) ?? null
      : null)
  const decisionSource = entry.eventDecision?.source ?? primaryTriage?.source
  const decisionConfidence =
    entry.eventDecision?.confidence ?? primaryTriage?.confidence
  const decisionReasoning = entry.eventDecision?.reasoning ?? primaryTriage?.reasoning
  const decisionReviewSummary = entry.eventDecision?.reviewSummary

  if (entry.type === 'decision') {
    return (
      <div className="space-y-3 border-t border-zinc-200/55 px-4 py-4 dark:border-zinc-800/55">
        {displaySignal ? (
          <button
            type="button"
            onClick={() => onSelectSignal(displaySignal.id)}
            className="w-full rounded-xl border border-zinc-200/65 bg-zinc-50/80 p-3 text-left transition hover:border-zinc-300/75 hover:bg-zinc-100/80 dark:border-zinc-700/25 dark:bg-zinc-900/40 dark:hover:border-zinc-600/45 dark:hover:bg-zinc-900/60"
          >
            <p className="text-[11px] font-medium tracking-wide text-zinc-500 uppercase dark:text-zinc-400">
              Alert context
            </p>
            <p className="mt-1 text-sm font-medium text-zinc-900 dark:text-zinc-100">
              {displaySignal.title}
            </p>
            <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
              {displaySignal.summary}
            </p>
          </button>
        ) : null}
        {primaryTriage || entry.eventDecision ? (
          <>
            <div className="rounded-xl border border-zinc-200/65 bg-zinc-50/80 p-3 dark:border-zinc-700/25 dark:bg-zinc-900/40">
              <p className="text-[11px] font-medium tracking-wide text-zinc-500 uppercase dark:text-zinc-400">
                Classification basis
              </p>
              <p className="mt-1 text-sm font-medium text-zinc-900 dark:text-zinc-100">
                {primaryTriage?.expectationViolated ??
                  'This incident breached the expected workflow threshold for the selected response.'}
              </p>
              <p className="mt-2 text-sm text-zinc-700 dark:text-zinc-300">
                {decisionReasoning ??
                  'No classification reasoning was recorded for this decision.'}
              </p>
            </div>
            <div className="rounded-xl border border-zinc-200/65 bg-zinc-50/80 p-3 dark:border-zinc-700/25 dark:bg-zinc-900/40">
              <p className="text-[11px] font-medium tracking-wide text-zinc-500 uppercase dark:text-zinc-400">
                Review context
              </p>
              <p className="mt-1 text-sm font-medium text-zinc-900 dark:text-zinc-100">
                {entry.title.replace('Decision: ', '')}
              </p>
              <p className="mt-2 text-sm text-zinc-700 dark:text-zinc-300">
                {decisionReviewSummary ??
                  'No extra review context was recorded for this decision.'}
              </p>
            </div>
          </>
        ) : (
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            No decision details are available yet.
          </p>
        )}
        {signals.length > 1 ? (
          <div className="space-y-2">
            <p className="text-[11px] font-medium tracking-wide text-zinc-500 uppercase dark:text-zinc-400">
              Supporting signals
            </p>
            {signals.map((signal) => (
              <button
                key={signal.id}
                type="button"
                onClick={() => onSelectSignal(signal.id)}
                className={`w-full rounded-xl border p-3 text-left transition ${
                  signal.id === primarySignal?.id
                    ? 'border-teal-300/65 bg-teal-50 dark:border-teal-500/25 dark:bg-teal-500/10'
                    : 'border-zinc-200/65 bg-zinc-50/80 dark:border-zinc-700/25 dark:bg-zinc-900/40'
                }`}
              >
                <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                  {signal.title}
                </p>
                <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
                  {signal.summary}
                </p>
              </button>
            ))}
          </div>
        ) : null}
        {(primaryTriage || decisionConfidence !== undefined || isAiPending) ? (
          <div className="rounded-xl border border-zinc-200/65 bg-zinc-50/80 p-3 dark:border-zinc-700/25 dark:bg-zinc-900/40">
            <p className="text-[11px] font-medium tracking-wide text-zinc-500 uppercase dark:text-zinc-400">
              Decision metadata
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              {primaryTriage ? (
                <>
                  <DemoBadge color={triageSourceBadgeColor[primaryTriage.source]}>
                    {triageSourceLabel[primaryTriage.source]}
                  </DemoBadge>
                  <DemoBadge color={severityBadgeColor[primaryTriage.severity]}>
                    {primaryTriage.severity}
                  </DemoBadge>
                </>
              ) : null}
              {decisionConfidence !== undefined ? (
                <DemoBadge color="gray">
                  {getDecisionConfidenceLabel(decisionConfidence) ??
                    `${Math.round(decisionConfidence * 100)}% confidence`}
                </DemoBadge>
              ) : null}
              {isAiPending ? <DemoBadge color="gray">AI thinking</DemoBadge> : null}
            </div>
            <p className="mt-3 text-sm text-zinc-700 dark:text-zinc-300">
              {getDecisionSourceCopy(decisionSource ?? 'deterministic', isAiPending)}
            </p>
          </div>
        ) : null}
      </div>
    )
  }

  const projectedActionDiff =
    entry.type === 'action'
      ? entry.before && entry.after
        ? null
        : (() => {
            const baselineTask = entry.previousTask ?? task

            if (!baselineTask) {
              return null
            }

            return {
              before: captureTaskStateSnapshot(baselineTask),
              after: projectTaskStateSnapshotForAction(
                baselineTask,
                primaryAction?.type ??
                  (entry.title.includes('Monitor tuned')
                    ? 'monitored'
                    : entry.title.includes('Fix proposed')
                      ? 'escalated'
                      : entry.title.includes('Stand down')
                        ? 'ignored'
                        : entry.title.includes('Escalated')
                          ? 'escalated'
                          : entry.title.includes('Updated')
                            ? 'monitored'
                            : entry.title.includes('No change')
                              ? 'ignored'
                              : 'ignored'),
              ),
            }
          })()
      : null
  const beforeSnapshot =
    entry.before ??
    projectedActionDiff?.before ??
    (entry.previousTask ? captureTaskStateSnapshot(entry.previousTask) : null)
  const afterSnapshot =
    entry.after ??
    projectedActionDiff?.after ??
    (task ? captureTaskStateSnapshot(task) : null)
  const actionTriage = entry.eventTriage ?? null
  const actionSummary = entry.eventAction ?? null
  const isMonitorTuned = entry.title === 'Outcome: Monitor tuned'
  const isStandDown = entry.title === 'Outcome: Stand down'
  const isNoAction = entry.title === 'Outcome: No action'
  const isFixProposed = entry.title === 'Outcome: Fix proposed'
  const isLightweightActionDetail =
    actionSummary?.type === 'monitored' || actionSummary?.type === 'ignored'
  const guardrailStatus = actionTriage?.guardrailStatus
  const shouldShowGuardrailBadge =
    !!guardrailStatus &&
    !(guardrailStatus === 'not_needed' && isLightweightActionDetail)
  const lightweightSuggestedLabel = isMonitorTuned
    ? 'Threshold change'
    : isStandDown
      ? 'Existing fix path'
      : isNoAction
        ? 'Next evaluation window'
      : 'Suggested next step'
  const lightweightOutcomeLabel = isMonitorTuned
    ? 'Next evaluation window'
    : isStandDown
      ? 'Re-alert conditions'
      : isNoAction
        ? 'Current state'
      : 'What happened'
  const lightweightSuggestedDetail = isNoAction
    ? 'No further action was taken during this sweep. Re-alert only if the signal persists or worsens in a later pass.'
    : actionTriage?.suggestedRemediation
  const lightweightOutcomeDetail = isMonitorTuned
    ? 'Re-alert only if the signal persists after the tuned threshold is applied in a later sweep.'
    : isStandDown
      ? 'Alert again only if fresh evidence appears after the linked fix lands or the issue changes shape.'
      : isNoAction
        ? 'The task remained unchanged after review.'
      : actionSummary?.message ?? 'No resulting change was logged for this item.'
  const richSuggestedLabel = isFixProposed
    ? 'Proposed fix'
    : 'Suggested next step'
  const richOutcomeLabel = isFixProposed
    ? 'What ships next'
    : 'What happened'
  const diffFields =
    beforeSnapshot && afterSnapshot
      ? getChangedTaskSnapshotFields(beforeSnapshot, afterSnapshot)
      : []
  const visibleDiffFields =
    beforeSnapshot && afterSnapshot
      ? getVisibleTaskSnapshotFields(beforeSnapshot, afterSnapshot)
      : (['status', 'owner'] as Array<keyof TaskStateSnapshot>)

  if (isLightweightActionDetail) {
    return (
      <div className="space-y-3 border-t border-zinc-200/55 px-4 py-4 dark:border-zinc-800/55">
        {lightweightSuggestedDetail ? (
          <div className="rounded-xl border border-zinc-200/65 bg-zinc-50/80 p-3 dark:border-zinc-700/25 dark:bg-zinc-900/40">
            <p className="text-[11px] font-medium tracking-wide text-zinc-500 uppercase dark:text-zinc-400">
              {lightweightSuggestedLabel}
            </p>
            <p className="mt-1 text-sm font-medium text-zinc-900 dark:text-zinc-100">
              {lightweightSuggestedDetail}
            </p>
          </div>
        ) : null}
        <div className="rounded-xl border border-zinc-200/65 bg-zinc-50/80 p-3 dark:border-zinc-700/25 dark:bg-zinc-900/40">
          <p className="text-[11px] font-medium tracking-wide text-zinc-500 uppercase dark:text-zinc-400">
            {lightweightOutcomeLabel}
          </p>
          {actionSummary ? (
            <div className="mt-1 space-y-2">
              <DemoBadge color={actionBadgeColor[actionSummary.type]}>
                {actionSummary.type}
              </DemoBadge>
              <p className="text-sm text-zinc-700 dark:text-zinc-300">
                {lightweightOutcomeDetail}
              </p>
              <p className="text-[11px] font-medium tracking-wide text-zinc-500 uppercase dark:text-zinc-400">
                {actionSummary.timestamp}
              </p>
            </div>
          ) : (
            <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
              No resulting change was logged for this item.
            </p>
          )}
        </div>
      </div>
    )
  }

  if (isFixProposed) {
    return (
      <div className="space-y-3 border-t border-zinc-200/55 px-4 py-4 dark:border-zinc-800/55">
        <div className="rounded-xl border border-zinc-200/65 bg-zinc-50/80 p-3 dark:border-zinc-700/25 dark:bg-zinc-900/40">
          <p className="text-[11px] font-medium tracking-wide text-zinc-500 uppercase dark:text-zinc-400">
            Reproduction status
          </p>
          <p className="mt-1 text-sm font-medium text-zinc-900 dark:text-zinc-100">
            The alert reproduced cleanly in a reviewable workflow.
          </p>
          <p className="mt-2 text-sm text-zinc-700 dark:text-zinc-300">
            {entry.decision?.reasoning ??
              'The alert reproduced cleanly enough to require a reviewable fix path.'}
          </p>
        </div>
        <div className="rounded-xl border border-zinc-200/65 bg-zinc-50/80 p-3 dark:border-zinc-700/25 dark:bg-zinc-900/40">
          <p className="text-[11px] font-medium tracking-wide text-zinc-500 uppercase dark:text-zinc-400">
            Proposed fix
          </p>
          <p className="mt-1 text-sm font-medium text-zinc-900 dark:text-zinc-100">
            {actionTriage?.suggestedRemediation ??
              'A bounded fix proposal is ready for engineer review.'}
          </p>
        </div>
          <div className="rounded-xl border border-zinc-200/65 bg-zinc-50/80 p-3 dark:border-zinc-700/25 dark:bg-zinc-900/40">
            <div className="flex items-center justify-between gap-3">
              <p className="text-[11px] font-medium tracking-wide text-zinc-500 uppercase dark:text-zinc-400">
                Review requirement
            </p>
            {shouldShowGuardrailBadge ? (
              <DemoBadge color={guardrailBadgeColor[guardrailStatus!]}>
                {guardrailLabel[guardrailStatus!]}
              </DemoBadge>
            ) : null}
          </div>
          <p className="mt-1 text-sm text-zinc-700 dark:text-zinc-300">
            {actionTriage?.guardrailReason ??
              'Engineer review is required before the proposal can be accepted.'}
          </p>
        </div>
        <div className="rounded-xl border border-zinc-200/65 bg-zinc-50/80 p-3 dark:border-zinc-700/25 dark:bg-zinc-900/40">
          <p className="text-[11px] font-medium tracking-wide text-zinc-500 uppercase dark:text-zinc-400">
            What ships next
          </p>
          {actionSummary ? (
            <div className="mt-1 space-y-2">
              <DemoBadge color={actionBadgeColor[actionSummary.type]}>
                {actionSummary.type}
              </DemoBadge>
              <p className="text-sm text-zinc-700 dark:text-zinc-300">
                {actionSummary.message}
              </p>
              <p className="text-[11px] font-medium tracking-wide text-zinc-500 uppercase dark:text-zinc-400">
                {actionSummary.timestamp}
              </p>
            </div>
          ) : (
            <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
              No resulting change was logged for this item.
            </p>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-3 border-t border-zinc-200/55 px-4 py-4 dark:border-zinc-800/55">
      {actionTriage ? (
        <>
          <div className="rounded-xl border border-zinc-200/65 bg-zinc-50/80 p-3 dark:border-zinc-700/25 dark:bg-zinc-900/40">
            <p className="text-[11px] font-medium tracking-wide text-zinc-500 uppercase dark:text-zinc-400">
              {richSuggestedLabel}
            </p>
            <p className="mt-1 text-sm font-medium text-zinc-900 dark:text-zinc-100">
              {actionTriage.suggestedRemediation ??
                'No remediation suggestion recorded.'}
            </p>
          </div>
          <div className="rounded-xl border border-zinc-200/65 bg-zinc-50/80 p-3 dark:border-zinc-700/25 dark:bg-zinc-900/40">
            <div className="flex items-center justify-between gap-3">
              <p className="text-[11px] font-medium tracking-wide text-zinc-500 uppercase dark:text-zinc-400">
                Guardrail note
              </p>
              {shouldShowGuardrailBadge ? (
                <DemoBadge color={guardrailBadgeColor[guardrailStatus!]}>
                  {guardrailLabel[guardrailStatus!]}
                </DemoBadge>
              ) : null}
            </div>
            <p className="mt-1 text-sm text-zinc-700 dark:text-zinc-300">
              {actionTriage.guardrailReason ??
                'No additional guardrail note was recorded for this outcome.'}
            </p>
          </div>
        </>
      ) : null}
      <div className="rounded-xl border border-zinc-200/65 bg-zinc-50/80 p-3 dark:border-zinc-700/25 dark:bg-zinc-900/40">
        <p className="text-[11px] font-medium tracking-wide text-zinc-500 uppercase dark:text-zinc-400">
          {richOutcomeLabel}
        </p>
        {actionSummary ? (
          <div className="mt-1 space-y-2">
            <DemoBadge color={actionBadgeColor[actionSummary.type]}>
              {actionSummary.type}
            </DemoBadge>
            <p className="text-sm text-zinc-700 dark:text-zinc-300">
              {actionSummary.message}
            </p>
            <p className="text-[11px] font-medium tracking-wide text-zinc-500 uppercase dark:text-zinc-400">
              {actionSummary.timestamp}
            </p>
          </div>
        ) : (
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            No resulting change was logged for this item.
          </p>
        )}
      </div>
      {beforeSnapshot && afterSnapshot ? (
        <div className="space-y-3">
          {diffFields.length === 0 ? (
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              No task fields changed for this action.
            </p>
          ) : null}
          <TaskStateDiff
            label="Before"
            tone="before"
            snapshot={beforeSnapshot}
            visibleFields={visibleDiffFields}
            changedFields={diffFields}
          />
          <TaskStateDiff
            label="After"
            tone="after"
            snapshot={afterSnapshot}
            visibleFields={visibleDiffFields}
            changedFields={diffFields}
          />
        </div>
      ) : null}
    </div>
  )
}

function TaskStateDiff({
  label,
  tone,
  snapshot,
  visibleFields,
  changedFields,
}: {
  label: 'Before' | 'After'
  tone: 'before' | 'after'
  snapshot: TaskStateSnapshot
  visibleFields: Array<keyof TaskStateSnapshot>
  changedFields: Array<keyof TaskStateSnapshot>
}) {
  const panelClass =
    tone === 'before'
      ? 'border-red-200/70 bg-red-50/70 dark:border-red-500/22 dark:bg-red-500/8'
      : 'border-green-200/70 bg-green-50/70 dark:border-green-500/22 dark:bg-green-500/8'
  const labelClass =
    tone === 'before'
      ? 'text-red-700 dark:text-red-300'
      : 'text-green-700 dark:text-green-300'
  const marker = tone === 'before' ? '-' : '+'

  return (
    <div className={`rounded-xl border p-3 ${panelClass}`}>
      <p
        className={`text-[11px] font-medium tracking-wide uppercase ${labelClass}`}
      >
        {label}
      </p>
      <div className="mt-2 space-y-2">
        {visibleFields.map((field) => {
          const isChanged = changedFields.includes(field)
          const valueClass = isChanged
            ? tone === 'before'
              ? 'font-medium text-red-700 dark:text-red-300'
              : 'font-medium text-green-700 dark:text-green-300'
            : 'text-zinc-700 dark:text-zinc-300'
          const markerClass = isChanged
            ? tone === 'before'
              ? 'text-red-500 dark:text-red-400'
              : 'text-green-500 dark:text-green-400'
            : 'text-zinc-300 dark:text-zinc-600'

          return (
            <div
              key={`${label}-${field}`}
              className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-x-3 gap-y-1 text-sm"
            >
              <span className={`font-mono text-xs ${markerClass}`}>
                {isChanged ? marker : '\u00b7'}
              </span>
              <div className="flex items-start justify-between gap-4">
                <span className="font-medium text-zinc-600 dark:text-zinc-400">
                  {formatTaskSnapshotFieldLabel(field)}
                </span>
                <span className={`text-right ${valueClass}`}>
                  {formatTaskSnapshotFieldValue(snapshot[field])}
                </span>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function TimelineEventRow({
  entry,
  isLast,
  isSelected,
  isRecent,
  isExpanded,
  scrollContainerRef,
  pulseToken,
  shouldScrollIntoView = false,
  insightContext,
  onSelectSignal,
  onSelectEvent,
  onToggleExpand,
}: {
  entry: TimelineEvent
  isLast: boolean
  isSelected: boolean
  isRecent: boolean
  isExpanded: boolean
  scrollContainerRef: React.RefObject<HTMLDivElement | null>
  pulseToken?: number | null
  shouldScrollIntoView?: boolean
  insightContext: TaskInsightContext | null
  onSelectSignal: (signalId: string) => void
  onSelectEvent: () => void
  onToggleExpand: () => void
}) {
  const rowRef = useRef<HTMLLIElement | null>(null)
  const cardRef = useRef<HTMLDivElement | null>(null)
  const isLightweightPassEntry =
    entry.type === 'action' && entry.title === 'No issue detected'
  const decisionConfidenceLabel =
    entry.type === 'decision'
      ? getDecisionConfidenceLabel(
          insightContext?.primaryTriage?.confidence ?? entry.eventDecision?.confidence,
        )
      : null
  const isExpandable =
    (entry.type === 'decision' ||
      (entry.type === 'action' && !isLightweightPassEntry && insightContext !== null) ||
      (entry.type === 'complete' && !!entry.completionSummary))
  const EXPANDED_ROW_TOP_OFFSET = 12
  const EXPANDED_ROW_SCROLL_DELAY_MS = 340

  const scrollRowToTop = useCallback(() => {
    const row = rowRef.current
    const container = scrollContainerRef.current

    if (!row || !container) {
      return
    }

    const topOffset = Math.max(0, row.offsetTop - EXPANDED_ROW_TOP_OFFSET)

    container.scrollTo({
      top: topOffset,
      behavior: 'smooth',
    })
  }, [scrollContainerRef])

  useEffect(() => {
    if (!shouldScrollIntoView) {
      return
    }

    window.requestAnimationFrame(() => {
      scrollRowToTop()
    })
  }, [scrollRowToTop, shouldScrollIntoView])

  useEffect(() => {
    if (!isExpanded) {
      return
    }

    const timeoutId = window.setTimeout(() => {
      window.requestAnimationFrame(() => {
        scrollRowToTop()
      })
    }, EXPANDED_ROW_SCROLL_DELAY_MS)

    return () => {
      window.clearTimeout(timeoutId)
    }
  }, [isExpanded, scrollRowToTop])

  useEffect(() => {
    if (!pulseToken) {
      return
    }

    const animation = cardRef.current?.animate(
      [
        {
          transform: 'scale(1)',
          boxShadow: '0 0 0 rgba(0, 0, 0, 0)',
        },
        {
          transform: 'scale(1.015)',
          boxShadow: '0 14px 34px rgba(0, 0, 0, 0.12)',
        },
        {
          transform: 'scale(1)',
          boxShadow: '0 0 0 rgba(0, 0, 0, 0)',
        },
      ],
      {
        duration: TIMELINE_PULSE_MS,
        easing: 'ease-out',
      },
    )

    return () => {
      animation?.cancel()
    }
  }, [pulseToken])

  const rowCardClass = `transition duration-[750ms] ${getTimelineEventToneClasses(
    entry,
    isSelected,
  )} ${isRecent ? 'demo-flicker-ring' : ''}`

  if (!isExpandable) {
    return (
      <Transition
        as={Fragment}
        show={true}
        appear
        enter="transition duration-1000 ease-out"
        enterFrom="opacity-0"
        enterTo="opacity-100"
      >
        <li ref={rowRef}>
          <div className="relative pb-5">
            {!isLast ? (
              <span
                aria-hidden="true"
                className="absolute top-8 left-4 h-full w-px bg-zinc-200/75 dark:bg-zinc-800/75"
              />
            ) : null}
            <button
              type="button"
              onClick={onSelectEvent}
              className="relative flex w-full gap-3 text-left"
            >
              <span
                className={`relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full ring-8 ring-zinc-50/80 dark:ring-zinc-900/60 ${getTimelineEventIconClasses(
                  entry,
                )}`}
              >
                {renderTimelineEventIcon(entry)}
              </span>
              <div
                ref={cardRef}
                className={`min-w-0 flex-1 rounded-2xl border p-4 ${rowCardClass}`}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                    {entry.title}
                  </p>
                  {decisionConfidenceLabel ? (
                    <DemoBadge color="gray">{decisionConfidenceLabel}</DemoBadge>
                  ) : null}
                </div>
                <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
                  {entry.description}
                </p>
              </div>
            </button>
          </div>
        </li>
      </Transition>
    )
  }

  return (
    <Transition
      as={Fragment}
      show={true}
      appear
      enter="transition duration-1000 ease-out"
      enterFrom="opacity-0"
      enterTo="opacity-100"
    >
      <li ref={rowRef}>
        <div className="relative pb-5">
          {!isLast ? (
            <span
              aria-hidden="true"
              className="absolute top-8 left-4 h-full w-px bg-zinc-200/75 dark:bg-zinc-800/75"
            />
          ) : null}
          <div className="relative flex gap-3">
            <span
              className={`relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full ring-8 ring-zinc-50/80 dark:ring-zinc-900/60 ${getTimelineEventIconClasses(
                entry,
              )}`}
            >
              {renderTimelineEventIcon(entry)}
            </span>
            <div
              ref={cardRef}
              className={`min-w-0 flex-1 overflow-hidden rounded-2xl border ${rowCardClass}`}
            >
              <button
                type="button"
                onClick={() => {
                  onSelectEvent()
                  onToggleExpand()
                }}
                className="group flex w-full items-start justify-between gap-3 px-4 py-4 text-left"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                      {entry.title}
                    </p>
                    {decisionConfidenceLabel ? (
                      <DemoBadge color="gray">{decisionConfidenceLabel}</DemoBadge>
                    ) : null}
                  </div>
                  <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
                    {entry.description}
                  </p>
                </div>
                <ChevronDownIcon
                  className={`size-5 shrink-0 text-zinc-400 transition duration-200 dark:text-zinc-500 ${
                    isExpanded
                      ? 'rotate-180 text-zinc-600 dark:text-zinc-300'
                      : ''
                  }`}
                />
              </button>
              <Transition
                show={isExpanded}
                unmount={false}
                enter="transition-[max-height,opacity] duration-300 ease-out"
                enterFrom="max-h-0 opacity-0"
                enterTo="max-h-[40rem] opacity-100"
                leave="transition-[max-height,opacity] duration-250 ease-in"
                leaveFrom="max-h-[40rem] opacity-100"
                leaveTo="max-h-0 opacity-0"
              >
                <div className="overflow-hidden">
                  <TimelineEventDetails
                    entry={entry}
                    insightContext={insightContext}
                    onSelectSignal={onSelectSignal}
                  />
                </div>
              </Transition>
            </div>
          </div>
        </div>
      </li>
    </Transition>
  )
}

function TimelineLoadingRow({
  title,
  subtitle,
}: {
  title?: string
  subtitle?: string
}) {
  return (
    <li aria-hidden="true">
      <div className="relative pb-5">
        <span
          aria-hidden="true"
          className="absolute top-8 left-4 h-full w-px bg-zinc-200/75 dark:bg-zinc-800/75"
        />
        <div className="relative flex gap-3">
          <span className="relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-zinc-200/90 ring-8 ring-zinc-50/80 dark:bg-zinc-800 dark:ring-zinc-900/60">
            <span className="h-3.5 w-3.5 animate-pulse rounded-full bg-zinc-300 dark:bg-zinc-700" />
          </span>
          <div className="min-w-0 flex-1 rounded-2xl border border-zinc-200/65 bg-white p-4 shadow-sm ring-1 ring-zinc-900/4 dark:border-zinc-800/55 dark:bg-zinc-950 dark:ring-white/4">
            {title ? <span className="sr-only">{title}</span> : null}
            {subtitle ? <span className="sr-only">{subtitle}</span> : null}
            <div className="animate-pulse space-y-2">
              <div className="h-4 w-40 rounded bg-zinc-200 dark:bg-zinc-800" />
              <div className="h-3 w-64 max-w-full rounded bg-zinc-100 dark:bg-zinc-900/90" />
              <div className="h-3 w-52 max-w-[85%] rounded bg-zinc-100 dark:bg-zinc-900/90" />
            </div>
          </div>
        </div>
      </div>
    </li>
  )
}

export function SelfTriagingDemo() {
  const initialSnapshot = useMemo(
    () => buildDerivedSnapshot(cloneSnapshot(baseDemoSnapshot), 'initial'),
    [],
  )
  const initialSignalId = useMemo(
    () => getFirstSignalId(initialSnapshot),
    [initialSnapshot],
  )
  const initialAiTriage = useMemo(
    () =>
      TRIAGE_MODE === 'pseudo'
        ? buildPseudoSelectionTriage(initialSnapshot, initialSignalId)
        : {},
    [initialSignalId, initialSnapshot],
  )

  const [snapshot, setSnapshot] = useState<DemoSnapshot>(initialSnapshot)
  const [selectedSignalId, setSelectedSignalId] =
    useState<string>(initialSignalId)
  const [aiTriageBySignalId, setAiTriageBySignalId] =
    useState<Record<string, DemoTriage>>(initialAiTriage)
  const [aiPendingSignalIds, setAiPendingSignalIds] = useState<string[]>([])
  const [usageSummary, setUsageSummary] =
    useState<AiUsageSummary>(emptyUsageSummary)
  const [isTriagePassRunning, setIsTriagePassRunning] = useState(false)
  const [isBoardBooting, setIsBoardBooting] = useState(true)
  const [visibleBoardTaskIds, setVisibleBoardTaskIds] = useState<string[]>([])
  const [boardRevealQueue, setBoardRevealQueue] = useState<BoardRevealQueue>(
    () => buildBoardRevealQueue(initialSnapshot.tasks),
  )
  const [activeScanTaskId, setActiveScanTaskId] = useState<string | null>(null)
  const [activeTaskPhase, setActiveTaskPhase] = useState<{
    taskId: string
    phase: ActiveTaskPhase
  } | null>(null)
  const [recentlySignaledTaskIds, setRecentlySignaledTaskIds] = useState<
    string[]
  >([])
  const [recentlyTriagedTaskIds, setRecentlyTriagedTaskIds] = useState<
    string[]
  >([])
  const [recentlyPassedTaskIds, setRecentlyPassedTaskIds] = useState<string[]>(
    [],
  )
  const [timelineEvents, setTimelineEvents] = useState<TimelineEvent[]>([])
  const [recentTimelineEventIds, setRecentTimelineEventIds] = useState<
    string[]
  >([])
  const [selectedTimelineEventId, setSelectedTimelineEventId] = useState<
    string | null
  >(null)
  const [expandedTimelineEventId, setExpandedTimelineEventId] = useState<
    string | null
  >(null)
  const [pulsedTimelineEvent, setPulsedTimelineEvent] = useState<{
    id: string
    token: number
  } | null>(null)
  const [scrollToTimelineEventId, setScrollToTimelineEventId] = useState<
    string | null
  >(null)
  const [narrativeHeader, setNarrativeHeader] =
    useState<NarrativeHeader | null>(null)
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null)
  const [isAiInfoOpen, setIsAiInfoOpen] = useState(false)
  const [isHistoryOpen, setIsHistoryOpen] = useState(false)
  const [recentlyChangedTaskIds, setRecentlyChangedTaskIds] = useState<
    string[]
  >([])
  const [triagePassCount, setTriagePassCount] = useState(1)
  const [incidentCount, setIncidentCount] = useState(0)
  const contextVersionRef = useRef(0)
  const aiTriageCacheRef = useRef<Map<string, DemoTriage>>(new Map())
  const usageSummaryRef = useRef(usageSummary)
  const previousSnapshotRef = useRef<DemoSnapshot | null>(null)
  const historyBodyRef = useRef<HTMLDivElement | null>(null)
  const requestAiTriageRef = useRef<
    | ((
        nextSnapshot: DemoSnapshot,
        signalIds: string[],
        options?: {
          applyActions?: boolean
          actionPassLabel?: string
          version?: number
          seedActions?: DemoAction[]
        },
      ) => Promise<void>)
    | null
  >(null)

  useEffect(() => {
    usageSummaryRef.current = usageSummary
  }, [usageSummary])

  useEffect(() => {
    const previousSnapshot = previousSnapshotRef.current

    if (!previousSnapshot) {
      previousSnapshotRef.current = snapshot
      return
    }

    const changedTaskIds = snapshot.tasks
      .filter((task) => {
        const previousTask = previousSnapshot.tasks.find(
          (item) => item.id === task.id,
        )

        return (
          !previousTask || JSON.stringify(previousTask) !== JSON.stringify(task)
        )
      })
      .map((task) => task.id)

    if (changedTaskIds.length > 0) {
      setRecentlyChangedTaskIds(changedTaskIds)
      window.setTimeout(() => setRecentlyChangedTaskIds([]), 1400)
    }

    previousSnapshotRef.current = snapshot
  }, [snapshot])

  useEffect(() => {
    if (!isHistoryOpen || !isTriagePassRunning) {
      return
    }

    window.requestAnimationFrame(() => {
      const historyBody = historyBodyRef.current

      if (!historyBody) {
        return
      }

      historyBody.scrollTo({
        top: historyBody.scrollHeight,
        behavior: 'smooth',
      })
    })
  }, [isHistoryOpen, isTriagePassRunning, timelineEvents.length])

  const selectedSignal =
    snapshot.signals.find((signal) => signal.id === selectedSignalId) ?? null
  const selectedTimelineEvent =
    timelineEvents.find((event) => event.id === selectedTimelineEventId) ?? null
  const effectiveTriage = useMemo(
    () => ({
      ...snapshot.triage,
      ...aiTriageBySignalId,
    }),
    [snapshot.triage, aiTriageBySignalId],
  )
  const selectedTriage = selectedSignal
    ? effectiveTriage[selectedSignal.id]
    : null
  const activeTaskId =
    selectedTimelineEvent?.taskId ??
    selectedTaskId ??
    null
  const activeTaskTone: TaskFocusTone = selectedTimelineEvent
    ? getTimelineEventFocusTone(selectedTimelineEvent)
    : 'neutral'
  const isAnyTriagePending = aiPendingSignalIds.length > 0

  const groupedTasks = useMemo(
    () =>
      taskStatusOrder.map((status) => ({
        status,
        tasks: snapshot.tasks.filter((task) => task.status === status),
      })),
    [snapshot.tasks],
  )
  const needsAttentionTasks = useMemo(
    () =>
      snapshot.tasks.filter((task) => task.attentionState === 'needs_attention'),
    [snapshot.tasks],
  )
  const attentionReasonByTaskId = useMemo(() => {
    const reasonByTaskId = new Map<string, string>()

    for (const signal of snapshot.signals) {
      const triage = effectiveTriage[signal.id]
      const summary = triage?.reasoning ?? signal.summary

      if (!reasonByTaskId.has(signal.taskId)) {
        reasonByTaskId.set(signal.taskId, summary)
      }

      for (const relatedTaskId of signal.relatedTaskIds ?? []) {
        if (!reasonByTaskId.has(relatedTaskId)) {
          reasonByTaskId.set(relatedTaskId, signal.summary)
        }
      }
    }

    return reasonByTaskId
  }, [effectiveTriage, snapshot.signals])
  const signalKindByTaskId = useMemo(() => {
    const kindByTaskId = new Map<string, DemoSignal['kind']>()

    for (const signal of snapshot.signals) {
      if (!kindByTaskId.has(signal.taskId)) {
        kindByTaskId.set(signal.taskId, signal.kind)
      }

      for (const relatedTaskId of signal.relatedTaskIds ?? []) {
        if (!kindByTaskId.has(relatedTaskId)) {
          kindByTaskId.set(relatedTaskId, signal.kind)
        }
      }
    }

    return kindByTaskId
  }, [snapshot.signals])
  const aiReviewTaskIds = useMemo(() => {
    const taskIds = new Set<string>()

    for (const signalId of aiPendingSignalIds) {
      const signal = snapshot.signals.find((item) => item.id === signalId)

      if (signal) {
        taskIds.add(signal.taskId)
      }
    }

    return [...taskIds]
  }, [aiPendingSignalIds, snapshot.signals])
  const orderedTimelineEvents = useMemo(
    () =>
      [...timelineEvents].sort((left, right) => left.sequence - right.sequence),
    [timelineEvents],
  )

  function clearTimeline() {
    setTimelineEvents([])
    setRecentTimelineEventIds([])
    setSelectedTimelineEventId(null)
    setExpandedTimelineEventId(null)
    setSelectedTaskId(null)
    setPulsedTimelineEvent(null)
    setScrollToTimelineEventId(null)
  }

  function resetBoardRevealState() {
    setVisibleBoardTaskIds([])
    setBoardRevealQueue({})
  }

  function revealBoardTask(taskId: string) {
    setVisibleBoardTaskIds((current) =>
      current.includes(taskId) ? current : [...current, taskId],
    )
    setBoardRevealQueue((current) => {
      const nextQueue: BoardRevealQueue = { ...current }

      for (const status of taskStatusOrder) {
        const queuedIds = nextQueue[status] ?? []

        if (!queuedIds.includes(taskId)) {
          continue
        }

        nextQueue[status] = queuedIds.filter(
          (queuedTaskId) => queuedTaskId !== taskId,
        )
      }

      return nextQueue
    })
  }

  function clearNarrativeHeader() {
    setNarrativeHeader(null)
  }

  function resetRunState(options?: {
    boardQueue?: BoardRevealQueue
    keepBoardBooting?: boolean
  }) {
    setAiPendingSignalIds([])
    setUsageSummary(emptyUsageSummary)
    aiTriageCacheRef.current.clear()
    usageSummaryRef.current = emptyUsageSummary
    previousSnapshotRef.current = null
    setActiveScanTaskId(null)
    setActiveTaskPhase(null)
    setVisibleBoardTaskIds([])
    setBoardRevealQueue(options?.boardQueue ?? {})
    setRecentlySignaledTaskIds([])
    setRecentlyTriagedTaskIds([])
    setRecentlyPassedTaskIds([])
    setRecentlyChangedTaskIds([])
    setIsBoardBooting(options?.keepBoardBooting ?? false)
    clearTimeline()
    clearNarrativeHeader()
  }

  function appendTimelineEvent(entry: TimelineEvent) {
    setTimelineEvents((current) => [entry, ...current])
    if (entry.type === 'action') {
      setSelectedTimelineEventId(entry.id)
      setSelectedTaskId(entry.taskId ?? null)
    }
    setRecentTimelineEventIds((current) => [...new Set([entry.id, ...current])])
    window.setTimeout(() => {
      setRecentTimelineEventIds((current) =>
        current.filter((timelineEventId) => timelineEventId !== entry.id),
      )
    }, 1400)
  }

  function selectSignalForTask(taskId: string) {
    return (
      snapshot.signals.find((signal) => signal.taskId === taskId) ??
      snapshot.signals.find((signal) =>
        (signal.relatedTaskIds ?? []).includes(taskId),
      ) ??
      null
    )
  }

  function selectTimelineEvent(event: TimelineEvent) {
    setSelectedTimelineEventId(event.id)
    setScrollToTimelineEventId(null)

    if (event.signalId) {
      setSelectedSignalId(event.signalId)
    }

    if (event.taskId) {
      setSelectedTaskId(event.taskId)
      const matchingSignal = selectSignalForTask(event.taskId)

      setSelectedSignalId(matchingSignal?.id ?? '')
    }
  }

  function toggleTimelineEventExpansion(event: TimelineEvent) {
    setExpandedTimelineEventId((current) =>
      current === event.id ? null : event.id,
    )
  }

  function findLatestTimelineEventForTask(taskId: string) {
    return (
      timelineEvents.find(
        (event) => event.taskId === taskId && event.type !== 'monitoring',
      ) ?? null
    )
  }

  async function requestAiTriage(
    nextSnapshot: DemoSnapshot,
    signalIds: string[],
    options?: {
      applyActions?: boolean
      actionPassLabel?: string
      version?: number
      seedActions?: DemoAction[]
    },
  ) {
    if (signalIds.length === 0) {
      return
    }

    const version = options?.version ?? contextVersionRef.current
    const uniqueSignalIds = [...new Set(signalIds)]
    const signalById = new Map(
      nextSnapshot.signals.map((signal) => [signal.id, signal]),
    )
    const buildLocalFallbackTriage = (
      signalId: string,
      reason: string,
    ): DemoTriage => {
      const baseline = nextSnapshot.triage[signalId]

      if (baseline) {
        return markTriageFallback(baseline, reason)
      }

      return {
        signalId,
        expectationViolated: 'Task state should remain internally consistent.',
        severity: 'low',
        confidence: 0.5,
        decision: 'ignore',
        reasoning:
          'The deterministic fallback could not recover a complete baseline triage record.',
        source: 'fallback',
        aiDecision: 'ignore',
        suggestedRemediation:
          'Review the signal manually because no baseline triage record was available.',
        guardrailStatus: 'not_needed',
        guardrailReason: reason,
      }
    }
    const cachedTriageUpdates: Record<string, DemoTriage> = {}
    const uncachedSignalIds: string[] = []

    for (const signalId of uniqueSignalIds) {
      const signal = signalById.get(signalId)
      const baseline = nextSnapshot.triage[signalId]

      if (!signal || !baseline) {
        continue
      }

      const cacheKey = buildTriageContextKey(
        signal,
        nextSnapshot.tasks,
        baseline,
      )
      const cachedTriage = aiTriageCacheRef.current.get(cacheKey)

      if (cachedTriage) {
        cachedTriageUpdates[signalId] = cachedTriage
      } else {
        uncachedSignalIds.push(signalId)
      }
    }

    const applyTriageResults = (triageUpdates: Record<string, DemoTriage>) => {
      if (Object.keys(triageUpdates).length === 0) {
        return
      }

      setAiTriageBySignalId((current) => ({
        ...current,
        ...triageUpdates,
      }))

      if (!options?.applyActions) {
        return
      }

      const signalSet = new Set(Object.keys(triageUpdates))

      setSnapshot((currentSnapshot) => {
        if (contextVersionRef.current !== version) {
          return currentSnapshot
        }

        const triageForActions = {
          ...currentSnapshot.triage,
          ...triageUpdates,
        }
        const nextDerivedActions = currentSnapshot.signals
          .filter((signal) => signalSet.has(signal.id))
          .map((signal, index) =>
            deriveActionForSignal(
              signal,
              triageForActions[signal.id],
              currentSnapshot.tasks,
              `action-${options.actionPassLabel ?? 'ai'}-${signal.id}`,
              index === 0 ? 'AI triage just now' : signal.detectedAt,
            ),
          )

        return {
          ...currentSnapshot,
          actions: mergeActionEntries(
            options.seedActions ?? currentSnapshot.actions,
            nextDerivedActions,
          ),
        }
      })
    }

    if (Object.keys(cachedTriageUpdates).length > 0) {
      applyTriageResults(cachedTriageUpdates)
      setUsageSummary((current) => ({
        ...current,
        cacheHits: current.cacheHits + Object.keys(cachedTriageUpdates).length,
      }))
    }

    if (uncachedSignalIds.length === 0) {
      return
    }

    if (TRIAGE_MODE === 'pseudo') {
      const pseudoTriage = Object.fromEntries(
        uncachedSignalIds.map((signalId) => {
          const signal = signalById.get(signalId)
          const baseline = nextSnapshot.triage[signalId]

          if (!signal || !baseline) {
            return [
              signalId,
              buildLocalFallbackTriage(
                signalId,
                'Pseudo AI mode could not resolve the current triage context.',
              ),
            ]
          }

          const triage = simulatePseudoAiTriage(
            signal,
            nextSnapshot.tasks,
            baseline,
          )
          const cacheKey = buildTriageContextKey(
            signal,
            nextSnapshot.tasks,
            baseline,
          )
          aiTriageCacheRef.current.set(cacheKey, triage)

          return [signalId, triage]
        }),
      )

      applyTriageResults(pseudoTriage)
      return
    }

    if (usageSummaryRef.current.aiCalls >= MAX_AI_CALLS_PER_SESSION) {
      const fallbackTriage = Object.fromEntries(
        uncachedSignalIds.map((signalId) => [
          signalId,
          buildLocalFallbackTriage(
            signalId,
            `AI call limit reached for this session (${MAX_AI_CALLS_PER_SESSION}), so the deterministic baseline was used.`,
          ),
        ]),
      )

      applyTriageResults(fallbackTriage)
      setUsageSummary((current) => ({
        ...current,
        fallbacks: current.fallbacks + uncachedSignalIds.length,
      }))
      return
    }

    setAiPendingSignalIds((current) => [
      ...new Set([...current, ...uncachedSignalIds]),
    ])
    try {
      const response = await fetch('/api/demo-triage', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          tasks: nextSnapshot.tasks,
          signals: nextSnapshot.signals.filter((signal) =>
            uncachedSignalIds.includes(signal.id),
          ),
          triage: Object.fromEntries(
            uncachedSignalIds.map((signalId) => [
              signalId,
              nextSnapshot.triage[signalId],
            ]),
          ),
          actions: nextSnapshot.actions.filter((action) =>
            uncachedSignalIds.includes(action.signalId),
          ),
        }),
      })

      const payload = (await response.json()) as {
        triage?: Record<string, DemoTriage>
        usage?: {
          aiCalls?: number
          inputTokens?: number
          outputTokens?: number
          totalTokens?: number
        }
      }

      if (contextVersionRef.current !== version) {
        return
      }

      const nextAiTriage = payload.triage ?? {}
      const fallbackCount = Object.values(nextAiTriage).filter(
        (triage) => triage.source === 'fallback',
      ).length

      for (const signalId of uncachedSignalIds) {
        const signal = signalById.get(signalId)
        const baseline = nextSnapshot.triage[signalId]
        const triage = nextAiTriage[signalId]

        if (!signal || !baseline || !triage || triage.source !== 'ai') {
          continue
        }

        const cacheKey = buildTriageContextKey(
          signal,
          nextSnapshot.tasks,
          baseline,
        )
        aiTriageCacheRef.current.set(cacheKey, triage)
      }

      applyTriageResults(nextAiTriage)
      setUsageSummary((current) => ({
        aiCalls: current.aiCalls + (payload.usage?.aiCalls ?? 0),
        cacheHits: current.cacheHits,
        fallbacks: current.fallbacks + fallbackCount,
        inputTokens: current.inputTokens + (payload.usage?.inputTokens ?? 0),
        outputTokens: current.outputTokens + (payload.usage?.outputTokens ?? 0),
        totalTokens: current.totalTokens + (payload.usage?.totalTokens ?? 0),
      }))
    } catch {
      if (contextVersionRef.current !== version) {
        return
      }

      const fallbackTriage = Object.fromEntries(
        uncachedSignalIds.map((signalId) => [
          signalId,
          buildLocalFallbackTriage(
            signalId,
            'The AI request failed, so the deterministic baseline was used.',
          ),
        ]),
      )

      applyTriageResults(fallbackTriage)
      setUsageSummary((current) => ({
        ...current,
        fallbacks: current.fallbacks + uncachedSignalIds.length,
      }))
    } finally {
      if (contextVersionRef.current === version) {
        setAiPendingSignalIds((current) =>
          current.filter((signalId) => !uncachedSignalIds.includes(signalId)),
        )
      }
    }
  }

  requestAiTriageRef.current = requestAiTriage

  useEffect(() => {
    if (
      !selectedSignal ||
      aiTriageBySignalId[selectedSignal.id] ||
      aiPendingSignalIds.includes(selectedSignal.id)
    ) {
      return
    }

    void requestAiTriageRef.current?.(snapshot, [selectedSignal.id])
  }, [aiPendingSignalIds, aiTriageBySignalId, selectedSignal, snapshot])

  function resetDemo() {
    if (isTriagePassRunning) {
      return
    }

    const nextSnapshot = buildDerivedSnapshot(
      cloneSnapshot(baseDemoSnapshot),
      'initial',
    )
    const nextSelectedSignalId = getFirstSignalId(nextSnapshot)

    if (
      JSON.stringify(snapshot.tasks) === JSON.stringify(nextSnapshot.tasks) &&
      selectedSignalId === nextSelectedSignalId &&
      triagePassCount === 1 &&
      incidentCount === 0 &&
      aiPendingSignalIds.length === 0 &&
      isUsageSummaryEmpty(usageSummary)
    ) {
      return
    }

    contextVersionRef.current += 1
    setAiTriageBySignalId(
      TRIAGE_MODE === 'pseudo'
        ? buildPseudoSelectionTriage(nextSnapshot, nextSelectedSignalId)
        : {},
    )
    resetRunState({
      boardQueue: buildBoardRevealQueue(nextSnapshot.tasks),
      keepBoardBooting: true,
    })
    setSnapshot(nextSnapshot)
    setSelectedSignalId(nextSelectedSignalId)
    setTriagePassCount(1)
    setIncidentCount(0)
  }

  function seedWeirdData() {
    if (isTriagePassRunning) {
      return
    }

    const nextSnapshot = buildDerivedSnapshot(
      cloneSnapshot(weirdDemoSnapshot),
      'initial',
    )
    const nextSelectedSignalId = getFirstSignalId(nextSnapshot)
    contextVersionRef.current += 1
    setAiTriageBySignalId(
      TRIAGE_MODE === 'pseudo'
        ? buildPseudoSelectionTriage(nextSnapshot, nextSelectedSignalId)
        : {},
    )
    resetRunState({
      boardQueue: buildBoardRevealQueue(nextSnapshot.tasks),
      keepBoardBooting: true,
    })
    setSnapshot(nextSnapshot)
    setSelectedSignalId(nextSelectedSignalId)
    setTriagePassCount(1)
    setIncidentCount(0)
  }

  function runTriagePass() {
    if (isTriagePassRunning) {
      return
    }

    contextVersionRef.current += 1
    const version = contextVersionRef.current
    const nextPassCount = triagePassCount + 1
    const passLabel = `pass-${nextPassCount}`
    const runStartSnapshot = buildDerivedSnapshot(
      cloneSnapshot(baseDemoSnapshot),
      `${passLabel}-start`,
    )
    const runStartSignalId = getFirstSignalId(runStartSnapshot)

    setSnapshot(runStartSnapshot)
    setSelectedSignalId(runStartSignalId)
    setAiTriageBySignalId(
      TRIAGE_MODE === 'pseudo'
        ? buildPseudoSelectionTriage(runStartSnapshot, runStartSignalId)
        : {},
    )
    resetRunState({
      boardQueue: buildBoardRevealQueue(runStartSnapshot.tasks),
      keepBoardBooting: false,
    })
    setNarrativeHeader(buildNarrativeHeader('monitoring'))
    setIsTriagePassRunning(true)
    void (async () => {
      let workingTasks = runStartSnapshot.tasks.map((task) => ({ ...task }))
      const signalMessageByTaskId = new Map<string, string>()
      const burstCount = randomBetween(INCIDENT_BURST_MIN, INCIDENT_BURST_MAX)
      let appliedIncidents = 0
      const healthyTaskTitles: string[] = []
      const narrativeDecisions: Array<{
        decision: TaskPassDecision
        previousTask: DemoTask
      }> = []

      await wait(BASELINE_DELAY_MS)

      for (let burstIndex = 0; burstIndex < burstCount; burstIndex += 1) {
        if (contextVersionRef.current !== version) {
          return
        }

        const randomIncidentResult = applyRandomIncidents(workingTasks, {
          minIncidents: 1,
          maxIncidents: 1,
        })

        if (randomIncidentResult.incidentCount > 0) {
          workingTasks = randomIncidentResult.tasks
          appliedIncidents += randomIncidentResult.incidentCount
          for (const incidentEvent of randomIncidentResult.incidentEvents) {
            signalMessageByTaskId.set(incidentEvent.taskId, incidentEvent.message)
            await wait(BOARD_REVEAL_BEFORE_SIGNAL_MS)
          }
        }

        if (burstIndex < burstCount - 1) {
          await wait(
            randomBetween(INCIDENT_STAGGER_MIN_MS, INCIDENT_STAGGER_MAX_MS),
          )
        }
      }

      setIncidentCount(appliedIncidents)
      if (appliedIncidents > 0) {
        appendTimelineEvent(buildMonitoringNarrativeEntry())
      }
      setNarrativeHeader(buildNarrativeHeader('monitoring'))
      await wait(EVALUATION_DELAY_MS)
      const evaluationState = evaluateTasks(workingTasks, passLabel)
      const nextBoardRevealQueue = buildBoardRevealQueue(workingTasks)

      setBoardRevealQueue(nextBoardRevealQueue)

      const orderedTaskIds = taskStatusOrder.flatMap(
        (status) => nextBoardRevealQueue[status] ?? [],
      )

      for (const taskId of orderedTaskIds) {
        if (contextVersionRef.current !== version) {
          return
        }

        revealBoardTask(taskId)
        await wait(BOARD_REVEAL_BEFORE_EVALUATION_MS)

        if (contextVersionRef.current !== version) {
          return
        }

        setActiveScanTaskId(taskId)
        setActiveTaskPhase({ taskId, phase: 'scan' })
        setNarrativeHeader({
          title: 'Monitors active...',
          subtitle: `Scanning ${workingTasks.find((task) => task.id === taskId)?.title ?? 'task'} for drift and alert conditions.`,
        })
        await wait(SCAN_DELAY_MS)

        if (contextVersionRef.current !== version) {
          return
        }

        const currentTask = workingTasks.find((task) => task.id === taskId)

        if (!currentTask) {
          continue
        }

        const signalMessage = signalMessageByTaskId.get(taskId)
        const signalForTask =
          evaluationState.signals.find(
            (signal) =>
              signal.taskId === currentTask.id ||
              (signal.relatedTaskIds ?? []).includes(currentTask.id),
          ) ?? null

        if (signalMessage) {
          setActiveTaskPhase({ taskId, phase: 'signal' })
          setRecentlySignaledTaskIds((current) => [...new Set([taskId, ...current])])
          window.setTimeout(() => {
            setRecentlySignaledTaskIds((current) =>
              current.filter((currentTaskId) => currentTaskId !== taskId),
            )
          }, 1800)
          setSnapshot((current) => ({
            ...current,
            tasks: current.tasks.map((task) =>
              task.id === currentTask.id ? currentTask : task,
            ),
          }))
          const signalNarrative = buildSignalNarrativeContent(signalMessage)
          setNarrativeHeader({
            title: signalNarrative.title,
            subtitle: signalNarrative.description,
          })
          appendTimelineEvent(buildSignalNarrativeEntry(signalMessage))

          await wait(Math.max(350, Math.floor(DECISION_STAGGER_MS * 0.65)))

          if (contextVersionRef.current !== version) {
            return
          }

          if (TRIAGE_MODE === 'ai') {
            if (signalForTask) {
              setActiveTaskPhase({ taskId, phase: 'ai_review' })
              setNarrativeHeader({
                title: 'AI reviewing alert',
                subtitle: `${signalForTask.title} is being assessed against recent actions, current task context, and safe remediation paths.`,
              })

              await wait(Math.max(350, Math.floor(DECISION_STAGGER_MS * 0.55)))

              if (contextVersionRef.current !== version) {
                return
              }
            }
          }
        }

        const decision = evaluateTaskPassDecision(currentTask)
        if (decision.tone !== 'stable') {
          const signalId = selectFirstSignalForTask(
            {
              ...runStartSnapshot,
              tasks: workingTasks,
              signals: evaluationState.signals,
              triage: evaluationState.triage,
              actions: runStartSnapshot.actions,
            },
            decision.nextTask.id,
          )
          const triageForDecision = signalId
            ? evaluationState.triage[signalId]
            : null

          narrativeDecisions.push({
            decision,
            previousTask: currentTask,
          })

          setNarrativeHeader({
            title: buildDecisionNarrativeLabel(decision),
            subtitle: triageForDecision?.reasoning ?? decision.reasoning,
          })
          setActiveTaskPhase({ taskId, phase: 'decision' })
          appendTimelineEvent(
            buildTimelineEvent(
              'decision',
              buildDecisionNarrativeLabel(decision),
              triageForDecision?.reasoning ?? decision.reasoning,
              {
                taskId: decision.nextTask.id,
                signalId,
                decisionTone: decision.tone,
                decision,
                eventDecision: buildDecisionEventSummary(
                  decision,
                  triageForDecision,
                  signalForTask,
                ),
              },
            ),
          )

          await wait(DECISION_STAGGER_MS)

          if (contextVersionRef.current !== version) {
            return
          }

          const nextWorkingTasks = workingTasks.map((task) =>
            task.id === decision.nextTask.id ? decision.nextTask : task,
          )
          const nextDerivedTimelineState = evaluateTasks(nextWorkingTasks, passLabel)
          const nextSignalId = selectFirstSignalForTask(
            {
              ...runStartSnapshot,
              tasks: nextWorkingTasks,
              signals: nextDerivedTimelineState.signals,
              triage: nextDerivedTimelineState.triage,
              actions: runStartSnapshot.actions,
            },
            decision.nextTask.id,
          )
          const triageForEvent = nextSignalId
            ? nextDerivedTimelineState.triage[nextSignalId]
            : null
          const actionType = deriveTimelineActionType(decision, currentTask)

          workingTasks = nextWorkingTasks
          setSnapshot((current) => ({
            ...current,
            tasks: workingTasks,
          }))
          setRecentlyTriagedTaskIds((current) => [
            ...new Set([decision.nextTask.id, ...current]),
          ])
          window.setTimeout(() => {
            setRecentlyTriagedTaskIds((current) =>
              current.filter(
                (currentTaskId) => currentTaskId !== decision.nextTask.id,
              ),
            )
          }, 1400)

          setNarrativeHeader({
            title: buildActionNarrativeLabel(decision, currentTask),
            subtitle: buildActionNarrativeDetail(decision, currentTask),
          })
          setActiveTaskPhase({ taskId, phase: 'action_issue' })
          appendTimelineEvent(
            buildTimelineEvent(
              'action',
              buildActionNarrativeLabel(decision, currentTask),
              buildActionNarrativeDetail(decision, currentTask),
              {
                taskId: decision.nextTask.id,
                signalId: nextSignalId,
                decisionTone: decision.tone,
                decision,
                previousTask: currentTask,
                before: captureTaskStateSnapshot(currentTask),
                after: projectTaskStateSnapshotForAction(currentTask, actionType),
                eventTriage: triageForEvent
                  ? {
                      suggestedRemediation: triageForEvent.suggestedRemediation,
                      guardrailStatus: triageForEvent.guardrailStatus,
                      guardrailReason: triageForEvent.guardrailReason,
                    }
                  : undefined,
                eventAction: {
                  type: actionType,
                  message: buildActionNarrativeDetail(decision, currentTask),
                  timestamp: 'During this sweep',
                },
              },
            ),
          )

          await wait(ACTION_STAGGER_MS)
        } else {
          healthyTaskTitles.push(currentTask.title)
          setRecentlyPassedTaskIds((current) => [...new Set([taskId, ...current])])
          window.setTimeout(() => {
            setRecentlyPassedTaskIds((current) =>
              current.filter((currentTaskId) => currentTaskId !== taskId),
            )
          }, 900)
          setNarrativeHeader({
            title: 'Monitors active...',
            subtitle: `${currentTask.title} cleared this monitor sweep.`,
          })
          if (ENABLE_FULL_AUDIT_MODE) {
            appendTimelineEvent(buildPassedScanNarrative(currentTask))
          }
          setActiveTaskPhase({ taskId, phase: 'action_pass' })
          await wait(Math.max(250, Math.floor(SCAN_DELAY_MS * 0.35)))
        }
      }

      if (contextVersionRef.current !== version) {
        return
      }

      setActiveScanTaskId(null)
      setActiveTaskPhase(null)

      if (contextVersionRef.current !== version) {
        return
      }

      const derived = evaluateTasks(workingTasks, passLabel)
      const nextSnapshot: DemoSnapshot = {
        ...snapshot,
        tasks: workingTasks,
        signals: derived.signals,
        triage: derived.triage,
        actions: snapshot.actions,
      }

      setAiTriageBySignalId({})
      setAiPendingSignalIds([])
      setSnapshot(nextSnapshot)
      setTriagePassCount(nextPassCount)
      setActiveScanTaskId(null)
      appendTimelineEvent(
        buildCompletionNarrativeEntry(
          buildCompletionSummary(
            narrativeDecisions.map((item) => item.decision),
            healthyTaskTitles,
          ),
        ),
      )
      clearNarrativeHeader()

      if (
        !selectedSignalId ||
        !nextSnapshot.signals.some((signal) => signal.id === selectedSignalId)
      ) {
        setSelectedSignalId(getFirstSignalId(nextSnapshot))
      }

      await requestAiTriage(
        nextSnapshot,
        nextSnapshot.signals.map((signal) => signal.id),
        {
          applyActions: true,
          actionPassLabel: passLabel,
          seedActions: snapshot.actions,
          version,
        },
      )
    })().finally(() => {
      if (contextVersionRef.current === version) {
        setActiveScanTaskId(null)
        resetBoardRevealState()
        setIsTriagePassRunning(false)
      }
    })
  }

  return (
    <section className="relative rounded-3xl border border-zinc-200/65 bg-white/85 p-6 shadow-sm ring-1 ring-zinc-900/4 dark:border-zinc-700/25 dark:bg-zinc-900/75 dark:ring-white/8">
      <div className="flex flex-col gap-5">
        <div className="space-y-3">
          <div className="space-y-2">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-3">
                  <h1 className="text-3xl font-semibold tracking-tight text-zinc-900 sm:text-4xl dark:text-zinc-100">
                    Self-triaging todo system
                  </h1>
                  <div
                    className="relative"
                    onMouseEnter={() => setIsAiInfoOpen(true)}
                    onMouseLeave={() => setIsAiInfoOpen(false)}
                  >
                    <button
                      type="button"
                      onClick={() => setIsAiInfoOpen((current) => !current)}
                      onFocus={() => setIsAiInfoOpen(true)}
                      onBlur={() => setIsAiInfoOpen(false)}
                      className={`${basePillClass} cursor-pointer border-zinc-300/65 bg-zinc-700 text-zinc-300 transition hover:border-zinc-200/75 hover:bg-zinc-600 hover:text-zinc-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400/60 dark:border-zinc-600/55 dark:bg-zinc-800 dark:text-zinc-400 dark:hover:border-zinc-500/70 dark:hover:bg-zinc-700 dark:hover:text-zinc-200`}
                    >
                      <span>{TRIAGE_MODE === 'ai' ? 'AI' : 'Local'}</span>
                      <span className="flex h-4 w-4 items-center justify-center rounded-full border border-white/22 text-[10px] leading-none text-white">
                        i
                      </span>
                    </button>
                    <Transition
                      as={Fragment}
                      show={isAiInfoOpen}
                      enter="transition ease-out duration-200"
                      enterFrom="opacity-0 translate-y-1"
                      enterTo="opacity-100 translate-y-0"
                      leave="transition ease-in duration-150"
                      leaveFrom="opacity-100 translate-y-0"
                      leaveTo="opacity-0 translate-y-1"
                    >
                      <div className="absolute top-full left-0 z-20 mt-3 w-80 overflow-hidden rounded-2xl border border-zinc-200/65 bg-white/95 shadow-2xl ring-1 ring-zinc-900/4 backdrop-blur dark:border-zinc-700/30 dark:bg-zinc-950/95 dark:ring-white/8">
                        <div className="space-y-2 rounded-2xl bg-zinc-100/80 p-4 dark:bg-zinc-900/60">
                          <p className="text-xs font-medium tracking-[0.16em] text-zinc-500 uppercase dark:text-zinc-400">
                            {TRIAGE_MODE === 'ai' ? 'AI mode' : 'Local mode'}
                          </p>
                          <p className="text-xs leading-5 text-zinc-600 dark:text-zinc-400">
                            {TRIAGE_MODE === 'ai'
                              ? 'Live model calls are enabled. Monitor evaluation, guardrails, and action logging run with model-assisted triage.'
                              : 'API calls are paused. Monitor evaluation, guardrails, and action logging still run locally, and identical alert contexts are cached for this session.'}
                          </p>
                          <div className="flex flex-wrap gap-2">
                            <DemoBadge color="blue">
                              Cache hits {usageSummary.cacheHits}
                            </DemoBadge>
                            <DemoBadge color="yellow">
                              Fallbacks {usageSummary.fallbacks}
                            </DemoBadge>
                            {TRIAGE_MODE === 'ai' ? (
                              <DemoBadge color="softTeal">
                                AI calls {usageSummary.aiCalls}
                              </DemoBadge>
                            ) : null}
                          </div>
                        </div>
                      </div>
                    </Transition>
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-3 self-start sm:pt-1">
                <button
                  type="button"
                  onClick={() => {
                    clearTimeline()
                    clearNarrativeHeader()
                    setIsHistoryOpen(true)
                    runTriagePass()
                  }}
                  disabled={isTriagePassRunning}
                  title={
                    isTriagePassRunning || isAnyTriagePending
                      ? 'Running monitor sweep'
                      : 'Run monitor sweep'
                  }
                  aria-label={
                    isTriagePassRunning || isAnyTriagePending
                      ? 'Running monitor sweep'
                      : 'Run monitor sweep'
                  }
                  className="inline-flex cursor-pointer items-center justify-center rounded-xl border border-zinc-200/65 bg-zinc-50/80 px-3 py-2 text-sm font-semibold text-zinc-700 shadow-sm ring-1 ring-zinc-900/4 transition hover:border-zinc-300/75 hover:bg-zinc-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400/60 disabled:cursor-default disabled:opacity-55 dark:border-zinc-700/30 dark:bg-zinc-900/50 dark:text-zinc-200 dark:ring-white/8 dark:hover:border-zinc-600/60 dark:hover:bg-zinc-800/80"
                >
                  <PlayIcon
                    className={`h-5 w-5 ${
                      isTriagePassRunning || isAnyTriagePending
                        ? 'animate-pulse'
                        : ''
                    }`}
                  />
                </button>
              </div>
            </div>
            <div className="max-w-3xl text-base leading-7 text-zinc-600 dark:text-zinc-400">
              <p>
                A local deterministic demo that turns monitor findings into
                investigation steps, triage decisions, and action history, then
                hands final judgment
                {TRIAGE_MODE === 'pseudo'
                  ? ' to a local pseudo-AI layer so the workflow can be reviewed without model calls.'
                  : ' to a real model with deterministic guardrails.'}
              </p>
            </div>
          </div>
        </div>

        <div className="space-y-6">
          <Panel
            title="Task board"
            description="Tasks are the monitored surface. Each card is scanned for drift, regression, and alert conditions."
            emphasis="primary"
          >
            <div className="space-y-4">
              <div className="grid gap-4 md:grid-cols-3">
                {groupedTasks.map(({ status, tasks }) => {
                  const visibleTaskCount = tasks.filter((task) =>
                    visibleBoardTaskIds.includes(task.id),
                  ).length
                  const displayTaskCount = isTriagePassRunning
                    ? visibleTaskCount
                    : tasks.length
                  const orderedVisibleTasks = tasks
                    .filter(
                      (task) =>
                        !isBoardBooting &&
                        (!isTriagePassRunning ||
                          visibleBoardTaskIds.includes(task.id)),
                    )
                    .sort(
                      (leftTask, rightTask) =>
                        visibleBoardTaskIds.indexOf(leftTask.id) -
                        visibleBoardTaskIds.indexOf(rightTask.id),
                    )

                  return (
                    <div
                      key={status}
                      className={`rounded-2xl border p-4 ${statusPanelClasses[status]}`}
                    >
                      <div className="mb-4 flex items-center justify-between gap-3">
                        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                          {statusLabels[status]}
                        </h2>
                        <DemoBadge color={statusBadgeColor[status]}>
                          {isBoardBooting ? 0 : displayTaskCount}
                        </DemoBadge>
                      </div>
                      <div className="space-y-3">
                        {orderedVisibleTasks.map((task) => {
                            const matchingTimelineEvent =
                              findLatestTimelineEventForTask(task.id)

                            return (
                              <Transition
                                key={task.id}
                                as={Fragment}
                                show={true}
                                appear
                                enter="transform transition duration-1000 ease-out"
                                enterFrom="-translate-x-6 opacity-0"
                                enterTo="translate-x-0 opacity-100"
                                leave="transition duration-150 ease-in"
                                leaveFrom="opacity-100"
                                leaveTo="opacity-0"
                              >
                                <div>
                                  <TaskCard
                                    task={task}
                                    attentionReason={
                                      attentionReasonByTaskId.get(task.id) ?? null
                                    }
                                    signalKind={signalKindByTaskId.get(task.id) ?? null}
                                    isFocused={activeTaskId === task.id}
                                    focusTone={activeTaskTone}
                                    hoverTone={getTimelineEventFocusTone(
                                      matchingTimelineEvent,
                                    )}
                                    onClick={
                                      matchingTimelineEvent
                                        ? () => {
                                            const pulseToken = Date.now()
                                            setSelectedTaskId(task.id)
                                            const nextSignal = selectSignalForTask(
                                              task.id,
                                            )
                                            setSelectedSignalId(nextSignal?.id ?? '')
                                            setSelectedTimelineEventId(
                                              matchingTimelineEvent.id,
                                            )
                                            setPulsedTimelineEvent({
                                              id: matchingTimelineEvent.id,
                                              token: pulseToken,
                                            })
                                            setScrollToTimelineEventId(
                                              matchingTimelineEvent.id,
                                            )
                                            setIsHistoryOpen(true)
                                          }
                                        : undefined
                                    }
                                    isActiveScan={activeScanTaskId === task.id}
                                    activePhase={
                                      activeTaskPhase?.taskId === task.id
                                        ? activeTaskPhase.phase
                                        : null
                                    }
                                    isAiReviewing={aiReviewTaskIds.includes(
                                      task.id,
                                    )}
                                    isRecentlySignaled={recentlySignaledTaskIds.includes(
                                      task.id,
                                    )}
                                    isRecentlyPassed={recentlyPassedTaskIds.includes(
                                      task.id,
                                    )}
                                    isRecentlyTriaged={recentlyTriagedTaskIds.includes(
                                      task.id,
                                    )}
                                    isRecentlyChanged={recentlyChangedTaskIds.includes(
                                      task.id,
                                    )}
                                  />
                                </div>
                              </Transition>
                            )
                          })}
                        {(boardRevealQueue[status] ?? []).map((queuedTaskId) => (
                          <TaskCardSkeleton
                            key={`${status}-skeleton-${queuedTaskId}`}
                          />
                        ))}
                      </div>
                    </div>
                  )
                })}
              </div>

              <div className="rounded-2xl border border-red-200/65 bg-red-50/70 p-4 dark:border-red-500/20 dark:bg-red-500/10">
                <div className="mb-4 flex items-center justify-between gap-3">
                  <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                    Needs attention
                  </h2>
                  <DemoBadge color="red">
                    {isBoardBooting ? 0 : needsAttentionTasks.length}
                  </DemoBadge>
                </div>
                <div className="space-y-3">
                  {needsAttentionTasks.length > 0 ? (
                    needsAttentionTasks.map((task) => {
                      const matchingTimelineEvent =
                        findLatestTimelineEventForTask(task.id)
                      const reason =
                        attentionReasonByTaskId.get(task.id) ??
                        'Flagged for review by deterministic triage rules.'

                      return (
                        <button
                          key={`attention-${task.id}`}
                          type="button"
                          title={reason}
                          onClick={() => {
                            const pulseToken = Date.now()
                            setSelectedTaskId(task.id)
                            const nextSignal = selectSignalForTask(task.id)
                            setSelectedSignalId(nextSignal?.id ?? '')
                            if (matchingTimelineEvent) {
                              setSelectedTimelineEventId(matchingTimelineEvent.id)
                              setPulsedTimelineEvent({
                                id: matchingTimelineEvent.id,
                                token: pulseToken,
                              })
                              setScrollToTimelineEventId(
                                matchingTimelineEvent.id,
                              )
                            }
                            setIsHistoryOpen(true)
                          }}
                          className="w-full rounded-2xl border border-red-200/70 bg-white/95 p-3 text-left shadow-sm transition hover:border-red-300/80 hover:shadow-[0_0_0_1px_rgba(248,113,113,0.12),0_12px_28px_rgba(239,68,68,0.14)] dark:border-red-500/20 dark:bg-zinc-950/85 dark:hover:border-red-500/35"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                              {task.title}
                            </p>
                            <DemoBadge color={statusBadgeColor[task.status]}>
                              {statusLabels[task.status]}
                            </DemoBadge>
                          </div>
                          <p className="mt-2 text-xs leading-5 text-zinc-600 dark:text-zinc-300">
                            {reason}
                          </p>
                        </button>
                      )
                    })
                  ) : (
                    <p className="text-sm text-zinc-600 dark:text-zinc-400">
                      No escalated items right now.
                    </p>
                  )}
                </div>
              </div>
            </div>
          </Panel>
        </div>
      </div>
      <Transition
        as={Fragment}
        show={isHistoryOpen}
        appear
        enter="transform transition duration-500 ease-in-out sm:duration-700"
        enterFrom="translate-x-full"
        enterTo="translate-x-0"
        leave="transform transition duration-500 ease-in-out sm:duration-700"
        leaveFrom="translate-x-0"
        leaveTo="translate-x-full"
      >
        <div className="pointer-events-none fixed inset-y-0 right-0 z-[60] flex max-w-full pl-10 sm:pl-16">
          <div className="pointer-events-auto w-screen max-w-md">
            <div className="relative flex h-full flex-col overflow-y-auto bg-white shadow-2xl dark:bg-zinc-950">
              <div className="border-b border-zinc-200/65 bg-zinc-100/90 px-4 py-6 shadow-inner sm:px-6 dark:border-zinc-800/55 dark:bg-zinc-900/90">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-zinc-200/80 text-zinc-700 ring-1 ring-zinc-300/45 dark:bg-zinc-800 dark:text-zinc-200 dark:ring-zinc-700/45">
                      <CpuChipIcon className="h-5 w-5" />
                    </div>
                    <div>
                      <h2 className="text-lg font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
                        Triage history
                      </h2>
                      <p className="mt-1 max-w-xs text-sm leading-6 text-zinc-600 dark:text-zinc-400">
                        Live decisions from the current session.
                      </p>
                    </div>
                  </div>
                  <div className="ml-3 flex h-7 items-center">
                    <button
                      type="button"
                      onClick={(event) => {
                        event.preventDefault()
                        event.stopPropagation()
                        setIsHistoryOpen(false)
                      }}
                      className="pointer-events-auto relative z-30 inline-flex h-10 w-10 cursor-pointer items-center justify-center rounded-xl text-zinc-500 transition hover:bg-zinc-200/75 hover:text-zinc-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400/60 dark:text-zinc-400 dark:hover:bg-zinc-800/80 dark:hover:text-zinc-100 dark:focus-visible:ring-zinc-500/60"
                    >
                      <span className="sr-only">Close panel</span>
                      <XMarkIcon aria-hidden="true" className="size-6" />
                    </button>
                  </div>
                </div>
              </div>
              <div
                ref={historyBodyRef}
                className="relative flex-1 space-y-3 overflow-y-auto bg-zinc-50/80 px-4 py-6 sm:px-6 dark:bg-zinc-900/60"
              >
                {timelineEvents.length > 0 || isTriagePassRunning ? (
                  <div className="flow-root">
                    <ul role="list" className="-mb-5">
                      {orderedTimelineEvents.map((entry, index, entries) => {
                        const insightContext = entry.taskId
                          ? buildTaskInsightContext({
                              snapshot,
                              effectiveTriage,
                              aiPendingSignalIds,
                              selectedSignalId:
                                entry.signalId ??
                                selectFirstSignalForTask(
                                  snapshot,
                                  entry.taskId,
                                ),
                              taskId: entry.taskId,
                            })
                          : null

                        return (
                          <TimelineEventRow
                            key={entry.id}
                            entry={entry}
                            isLast={index === entries.length - 1}
                            isSelected={selectedTimelineEventId === entry.id}
                            isRecent={recentTimelineEventIds.includes(entry.id)}
                            isExpanded={expandedTimelineEventId === entry.id}
                            scrollContainerRef={historyBodyRef}
                            pulseToken={
                              pulsedTimelineEvent?.id === entry.id
                                ? pulsedTimelineEvent.token
                                : null
                            }
                            shouldScrollIntoView={
                              isHistoryOpen &&
                              scrollToTimelineEventId === entry.id
                            }
                            insightContext={insightContext}
                            onSelectSignal={(signalId) => {
                              setSelectedTimelineEventId(entry.id)
                              setScrollToTimelineEventId(null)
                              setSelectedTaskId(entry.taskId ?? null)
                              setSelectedSignalId(signalId)
                            }}
                            onSelectEvent={() => selectTimelineEvent(entry)}
                            onToggleExpand={() =>
                              toggleTimelineEventExpansion(entry)
                            }
                          />
                        )
                      })}
                      {isTriagePassRunning ? (
                        <TimelineLoadingRow
                          title={narrativeHeader?.title}
                          subtitle={narrativeHeader?.subtitle}
                        />
                      ) : null}
                    </ul>
                  </div>
                ) : !isTriagePassRunning ? (
                  Array.from({ length: 5 }).map((_, index) => (
                    <div
                      key={`history-skeleton-${index}`}
                      className="rounded-2xl border border-zinc-200/65 bg-white p-4 shadow-sm ring-1 ring-zinc-900/4 dark:border-zinc-800/55 dark:bg-zinc-950 dark:ring-white/4"
                    >
                      <div className="flex items-start gap-3">
                        <div className="mt-0.5 h-9 w-9 shrink-0 animate-pulse rounded-xl bg-zinc-200 dark:bg-zinc-800" />
                        <div className="min-w-0 flex-1 space-y-2">
                          <div className="h-4 w-3/4 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800" />
                          <div className="h-3 w-full animate-pulse rounded bg-zinc-100 dark:bg-zinc-900/90" />
                          <div className="h-3 w-5/6 animate-pulse rounded bg-zinc-100 dark:bg-zinc-900/90" />
                        </div>
                      </div>
                    </div>
                  ))
                ) : null}
              </div>
            </div>
          </div>
        </div>
      </Transition>
      <style jsx>{`
        @keyframes demoFlickerRing {
          0% {
            box-shadow:
              0 0 0 0 rgba(45, 212, 191, 0.42),
              0 0 0 0 rgba(244, 250, 249, 0.3);
          }
          18% {
            box-shadow:
              0 0 0 1px rgba(45, 212, 191, 0.6),
              0 0 18px 2px rgba(45, 212, 191, 0.32);
          }
          34% {
            box-shadow:
              0 0 0 1px rgba(45, 212, 191, 0.26),
              0 0 6px 1px rgba(45, 212, 191, 0.12);
          }
          52% {
            box-shadow:
              0 0 0 1px rgba(45, 212, 191, 0.52),
              0 0 14px 2px rgba(45, 212, 191, 0.22);
          }
          100% {
            box-shadow:
              0 0 0 0 rgba(45, 212, 191, 0),
              0 0 0 0 rgba(45, 212, 191, 0);
          }
        }

        .demo-flicker-ring {
          animation: demoFlickerRing 1.15s ease-out;
        }

        @keyframes demoAlertRing {
          0% {
            box-shadow:
              0 0 0 0 rgba(248, 113, 113, 0.22),
              0 0 0 0 rgba(248, 113, 113, 0);
          }
          45% {
            box-shadow:
              0 0 0 1px rgba(248, 113, 113, 0.55),
              0 0 18px 2px rgba(248, 113, 113, 0.18);
          }
          100% {
            box-shadow:
              0 0 0 1px rgba(248, 113, 113, 0),
              0 0 0 0 rgba(248, 113, 113, 0);
          }
        }

        .demo-alert-ring {
          animation: demoAlertRing 0.9s ease-out;
        }

        @keyframes demoPassRing {
          0% {
            box-shadow:
              0 0 0 0 rgba(74, 222, 128, 0.2),
              0 0 0 0 rgba(74, 222, 128, 0);
          }
          45% {
            box-shadow:
              0 0 0 1px rgba(74, 222, 128, 0.52),
              0 0 18px 2px rgba(74, 222, 128, 0.16);
          }
          100% {
            box-shadow:
              0 0 0 1px rgba(74, 222, 128, 0),
              0 0 0 0 rgba(74, 222, 128, 0);
          }
        }

        .demo-pass-ring {
          animation: demoPassRing 0.8s ease-out;
        }

        @keyframes needsAttentionPulse {
          0% {
            box-shadow:
              0 0 0 1px rgba(248, 113, 113, 0.26),
              0 0 0 0 rgba(248, 113, 113, 0.16);
          }
          50% {
            box-shadow:
              0 0 0 1px rgba(248, 113, 113, 0.35),
              0 0 16px 2px rgba(248, 113, 113, 0.2);
          }
          100% {
            box-shadow:
              0 0 0 1px rgba(248, 113, 113, 0.26),
              0 0 0 0 rgba(248, 113, 113, 0.16);
          }
        }

        .needs-attention-pulse {
          animation: needsAttentionPulse 2.8s ease-in-out infinite;
        }
      `}</style>
    </section>
  )
}

function Panel({
  title,
  description,
  children,
  emphasis = 'secondary',
}: {
  title: string
  description: string
  children: React.ReactNode
  emphasis?: 'primary' | 'secondary' | 'tertiary'
}) {
  const panelClasses =
    emphasis === 'primary'
      ? 'border-zinc-300/65 bg-white/70 dark:border-zinc-600/35 dark:bg-zinc-900/40'
      : emphasis === 'secondary'
        ? 'border-zinc-200/65 bg-white/70 dark:border-zinc-700/25 dark:bg-zinc-900/40'
        : 'border-zinc-200/55 bg-zinc-50/70 dark:border-zinc-700/20 dark:bg-zinc-900/30'

  const descriptionClasses =
    emphasis === 'tertiary'
      ? 'text-sm leading-6 text-zinc-500 dark:text-zinc-400'
      : 'text-sm leading-6 text-zinc-600 dark:text-zinc-400'

  return (
    <section className={`rounded-2xl border p-5 ${panelClasses}`}>
      <div className="mb-4 space-y-1">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
          {title}
        </h2>
        <p className={descriptionClasses}>{description}</p>
      </div>
      {children}
    </section>
  )
}

function TaskCard({
  task,
  attentionReason = null,
  signalKind = null,
  isFocused = false,
  focusTone = 'neutral',
  hoverTone = null,
  onClick,
  isActiveScan = false,
  activePhase = null,
  isAiReviewing = false,
  isRecentlySignaled = false,
  isRecentlyPassed = false,
  isRecentlyTriaged = false,
  isRecentlyChanged = false,
}: {
  task: DemoTask
  attentionReason?: string | null
  signalKind?: DemoSignal['kind'] | null
  isFocused?: boolean
  focusTone?: TaskFocusTone
  hoverTone?: TaskFocusTone | null
  onClick?: () => void
  isActiveScan?: boolean
  activePhase?: ActiveTaskPhase | null
  isAiReviewing?: boolean
  isRecentlySignaled?: boolean
  isRecentlyPassed?: boolean
  isRecentlyTriaged?: boolean
  isRecentlyChanged?: boolean
}) {
  const isClickable = typeof onClick === 'function'
  const needsAttentionPulseClass =
    task.attentionState === 'needs_attention' ? 'needs-attention-pulse' : ''
  const titleClass =
    signalKind === 'duplicate_task'
      ? 'text-purple-700 dark:text-purple-300'
      : signalKind === 'fix_ready'
        ? 'text-sky-700 dark:text-sky-300'
      : 'text-zinc-900 dark:text-zinc-100'
  const ownerBadgeStyles =
    signalKind === 'missing_owner'
      ? 'inline-flex items-center rounded-full border border-amber-300/60 bg-amber-50 px-2 text-xs text-amber-800 dark:border-amber-500/25 dark:bg-amber-500/10 dark:text-amber-300'
      : undefined
  const ageLabelClass =
    signalKind === 'task_overdue'
      ? 'text-red-600 dark:text-red-300'
      : signalKind === 'stuck_in_progress'
        ? 'text-amber-600 dark:text-amber-300'
        : signalKind === 'noise_alert'
            ? 'text-zinc-500 dark:text-zinc-300'
          : signalKind === 'known_issue'
            ? 'text-blue-600 dark:text-blue-300'
            : signalKind === 'fix_ready'
              ? 'text-sky-600 dark:text-sky-300'
        : 'text-zinc-500 dark:text-zinc-400'
  const hoverClass =
    isClickable && !isFocused
      ? hoverTone === 'escalate'
        ? 'hover:border-red-300/65 hover:ring-1 hover:ring-red-200/45 dark:hover:border-red-500/25 dark:hover:ring-red-500/12'
        : hoverTone === 'monitor'
          ? 'hover:border-yellow-300/65 hover:ring-1 hover:ring-yellow-200/45 dark:hover:border-yellow-500/25 dark:hover:ring-yellow-500/12'
          : hoverTone === 'stable'
            ? 'hover:border-teal-300/65 hover:ring-1 hover:ring-teal-200/45 dark:hover:border-teal-500/25 dark:hover:ring-teal-500/12'
            : 'hover:border-zinc-300/75 hover:ring-1 hover:ring-zinc-300/45 dark:hover:border-zinc-500/45 dark:hover:ring-zinc-500/16'
      : ''

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!isClickable}
      title={task.attentionState === 'needs_attention' ? attentionReason ?? '' : undefined}
      className={`w-full rounded-2xl border bg-white px-4 py-5 shadow-sm transition duration-300 dark:bg-zinc-950/70 ${
        isFocused
          ? focusTone === 'escalate'
            ? 'border-red-300/65 ring-1 ring-red-200/50 dark:border-red-500/25 dark:ring-red-500/12'
            : focusTone === 'monitor'
              ? 'border-yellow-300/65 ring-1 ring-yellow-200/50 dark:border-yellow-500/25 dark:ring-yellow-500/12'
              : focusTone === 'stable'
                ? 'border-teal-300/65 ring-1 ring-teal-200/50 dark:border-teal-500/25 dark:ring-teal-500/12'
                : 'border-zinc-300/75 ring-1 ring-zinc-300/50 dark:border-zinc-500/45 dark:ring-zinc-500/18'
          : task.attentionState === 'needs_attention'
            ? 'border-red-200/70 ring-1 ring-red-200/40 dark:border-red-500/20 dark:ring-red-500/10'
            : task.attentionState === 'watch'
              ? 'border-yellow-200/70 ring-1 ring-yellow-200/40 dark:border-yellow-500/20 dark:ring-yellow-500/10'
              : 'border-zinc-200/65 dark:border-zinc-700/25'
      } ${
        isActiveScan
          ? activePhase === 'signal' || activePhase === 'action_issue'
            ? 'scale-[1.02] ring-2 ring-red-300/65 dark:ring-red-400/32'
            : activePhase === 'ai_review'
              ? 'scale-[1.02] ring-2 ring-teal-300/65 dark:ring-teal-400/32'
            : activePhase === 'evaluating'
            ? 'scale-[1.02] ring-2 ring-blue-300/65 dark:ring-blue-400/32'
            : activePhase === 'decision'
              ? 'scale-[1.02] ring-2 ring-indigo-300/65 dark:ring-indigo-400/32'
              : activePhase === 'action_pass'
                  ? 'scale-[1.02] ring-2 ring-green-300/65 dark:ring-green-400/32'
                  : 'scale-[1.02] ring-2 ring-amber-300/65 dark:ring-amber-400/32'
          : isRecentlySignaled || isRecentlyTriaged
            ? 'ring-2 ring-red-300/55 dark:ring-red-400/28'
          : isAiReviewing
            ? 'ring-2 ring-teal-300/55 dark:ring-teal-400/28'
          : isRecentlyPassed
            ? 'ring-2 ring-green-300/55 dark:ring-green-400/28'
          : ''
      } ${isRecentlyChanged ? 'demo-flicker-ring' : ''} ${
        isRecentlySignaled || isRecentlyTriaged ? 'demo-alert-ring' : ''
      } ${
        isRecentlyPassed ? 'demo-pass-ring' : ''
      } ${
        isClickable ? 'cursor-pointer' : 'cursor-default'
      } ${hoverClass} ${needsAttentionPulseClass} text-left`}
    >
      <div className="flex items-start justify-between gap-3">
        <p className={`text-sm font-semibold ${titleClass}`}>
          {task.title}
        </p>
        <Badge color="gray">{task.priority}</Badge>
      </div>
      {attentionReason ? (
        <p className="mt-2 text-xs leading-5 text-zinc-500 dark:text-zinc-400">
          {attentionReason}
        </p>
      ) : null}
      <div className="mt-4 flex flex-wrap items-center gap-2.5">
        <Badge
          color={task.owner ? 'blue' : 'yellow'}
          customStyles={ownerBadgeStyles}
        >
          {task.owner ?? 'Unassigned'}
        </Badge>
        {task.attentionState === 'needs_attention' ? (
          <Badge color="red">Needs attention</Badge>
        ) : task.attentionState === 'watch' ? (
          <Badge color="yellow">Watch</Badge>
        ) : null}
        {isActiveScan ? <Badge color="blue">Scanning</Badge> : null}
        {isAiReviewing && !isActiveScan ? (
          <Badge color="softTeal">AI reviewing</Badge>
        ) : null}
        {isRecentlyPassed ? (
          <span className="inline-flex items-center gap-1 rounded-full border border-green-300/60 bg-green-50 px-2 py-0.5 text-[11px] font-medium text-green-700 dark:border-green-500/25 dark:bg-green-500/10 dark:text-green-300">
            <CheckCircleIcon className="h-4 w-4" />
            Passed
          </span>
        ) : null}
        <span
          className={`text-[11px] font-medium tracking-wide uppercase ${ageLabelClass}`}
        >
          {task.ageLabel}
        </span>
      </div>
    </button>
  )
}

function TaskCardSkeleton() {
  return (
    <div className="rounded-2xl border border-zinc-200/65 bg-white px-4 py-5 shadow-sm dark:border-zinc-700/25 dark:bg-zinc-950/70">
      <div className="animate-pulse">
        <div className="flex items-start justify-between gap-3">
          <div className="h-4 w-40 rounded bg-zinc-200 dark:bg-zinc-800" />
          <div className="h-5 w-10 rounded-full bg-zinc-200 dark:bg-zinc-800" />
        </div>
        <div className="mt-4 flex items-center gap-2.5">
          <div className="h-5 w-20 rounded-full bg-zinc-100 dark:bg-zinc-900/90" />
          <div className="h-3 w-16 rounded bg-zinc-100 dark:bg-zinc-900/90" />
        </div>
      </div>
    </div>
  )
}
