'use client'

import {
  Transition,
} from '@headlessui/react'
import {
  BoltIcon,
  CheckCircleIcon,
  ChevronDownIcon,
  CpuChipIcon,
  EyeIcon,
  FlagIcon,
  MinusCircleIcon,
  PlayIcon,
  ScaleIcon,
  SparklesIcon,
} from '@heroicons/react/20/solid'
import { XMarkIcon } from '@heroicons/react/24/outline'
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
  problematic: 'Problematic',
}

const statusPanelClasses: Record<TaskStatus, string> = {
  backlog:
    'border-zinc-200/65 bg-white dark:border-zinc-700/35 dark:bg-zinc-900/60',
  in_progress:
    'border-blue-200/65 bg-blue-50/70 dark:border-blue-500/20 dark:bg-blue-500/10',
  done: 'border-green-200/65 bg-green-50/70 dark:border-green-500/20 dark:bg-green-500/10',
  problematic:
    'border-red-200/65 bg-red-50/70 dark:border-red-500/20 dark:bg-red-500/10',
}

const statusBadgeColor: Record<
  TaskStatus,
  React.ComponentProps<typeof Badge>['color']
> = {
  backlog: 'gray',
  in_progress: 'blue',
  done: 'green',
  problematic: 'red',
}

const signalBadgeColor: Record<
  DemoSignal['kind'],
  React.ComponentProps<typeof Badge>['color']
> = {
  task_overdue: 'yellow',
  missing_owner: 'red',
  duplicate_task: 'purple',
  stuck_in_progress: 'blue',
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
  fallback: 'Fallback decision',
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
const TRIAGE_MODE = 'pseudo' as const

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
type TimelineEvent = {
  id: string
  type: TimelineEventType
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

const emptyUsageSummary: AiUsageSummary = {
  aiCalls: 0,
  cacheHits: 0,
  fallbacks: 0,
  inputTokens: 0,
  outputTokens: 0,
  totalTokens: 0,
}

const SCAN_DELAY_MS = 700
const BASELINE_DELAY_MS = 2600
const EVALUATION_DELAY_MS = 1600
const ACTION_PHASE_DELAY_MS = 900
const INCIDENT_STAGGER_MIN_MS = 1100
const INCIDENT_STAGGER_MAX_MS = 1500
const DECISION_STAGGER_MS = 850
const ACTION_STAGGER_MS = 850
const BOARD_REVEAL_BEFORE_SIGNAL_MS = 1000
const BOARD_REVEAL_BEFORE_EVALUATION_MS = 550
const TIMELINE_PULSE_MS = 750
const INCIDENT_BURST_MIN = 5
const INCIDENT_BURST_MAX = 7
const basePillClass =
  'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium'
const subtlePillClass = 'inline-flex items-center rounded-full px-2 text-xs'
const narrativeCopy = {
  monitoring: {
    headerTitle: 'Monitoring system state...',
    headerSubtitle: 'Watching for changes and potential issues',
    entryTitle: 'Monitoring system state...',
    entryDetail: 'No issues detected. All tasks within expected range.',
  },
  signal: {
    title: 'Signal detected',
  },
  evaluating: {
    headerTitle: 'Evaluating signals...',
    headerSubtitle: 'Determining severity and required actions',
    entryTitle: 'Evaluating signals...',
    entryDetail: 'Determining severity and required actions',
  },
  decision: {
    escalate: 'Decision: Escalate',
    monitor: 'Decision: Monitor',
    stable: 'Decision: No change',
  },
  action: {
    noChange: 'Action: No change',
    escalated: 'Action: Escalated',
    updated: 'Action: Updated',
  },
  complete: {
    headerTitle: 'Triage complete',
    emptySummary: 'No issues required intervention',
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
  const incidentTypes = shuffleItems([
    'missing_owner',
    'task_overdue',
    'stuck_in_progress',
    'duplicate_task',
  ]).slice(0, incidentCount)

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

  if (task.status === 'problematic') {
    evidence.add('Problematic state')
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

  if (evidenceItem === 'Problematic state') {
    return 'border-red-300/55 bg-red-50 text-red-700 dark:border-red-500/18 dark:bg-red-500/10 dark:text-red-300'
  }

  return 'border-zinc-200/65 bg-zinc-100 text-zinc-600 dark:border-zinc-700/35 dark:bg-zinc-900 dark:text-zinc-300'
}

function buildActivityOutcome(
  decision: TaskPassDecision,
  previousTask: DemoTask,
) {
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
  },
): TimelineEvent {
  return {
    id: `narrative-${type}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    type,
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
      status: 'Problematic',
      tags: ['Manual review'],
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

function buildActionNarrativeLabel(
  decision: TaskPassDecision,
  previousTask: DemoTask,
) {
  const outcome = buildActivityOutcome(decision, previousTask)

  if (outcome === 'No action' || outcome === 'State validated') {
    return narrativeCopy.action.noChange
  }

  if (outcome.includes('Problematic') || decision.tone === 'escalate') {
    return narrativeCopy.action.escalated
  }

  return narrativeCopy.action.updated
}

function buildActionNarrativeDetail(
  decision: TaskPassDecision,
  previousTask: DemoTask,
) {
  const outcome = buildActivityOutcome(decision, previousTask)

  if (outcome === 'No action' || outcome === 'State validated') {
    return `${decision.nextTask.title} remains unchanged after evaluation`
  }

  if (decision.nextTask.status === 'problematic') {
    return `${decision.nextTask.title} moved to Problematic for review`
  }

  return `${decision.nextTask.title} updated after evaluation`
}

function deriveTimelineActionType(
  decision: TaskPassDecision,
  previousTask: DemoTask,
): DemoAction['type'] {
  const actionLabel = buildActionNarrativeLabel(decision, previousTask)

  if (actionLabel === narrativeCopy.action.escalated) {
    return 'escalated'
  }

  if (actionLabel === narrativeCopy.action.updated) {
    return 'monitored'
  }

  return 'ignored'
}

function summarizeCompletion(decisions: TaskPassDecision[]) {
  const escalatedCount = decisions.filter(
    (decision) => decision.tone === 'escalate',
  ).length
  const monitoredCount = decisions.filter(
    (decision) => decision.tone === 'monitor',
  ).length

  if (escalatedCount > 0 && monitoredCount > 0) {
    return `${escalatedCount} issue${escalatedCount === 1 ? '' : 's'} escalated, ${monitoredCount} monitored`
  }

  if (escalatedCount > 0) {
    return `${escalatedCount} issue${escalatedCount === 1 ? '' : 's'} escalated`
  }

  if (monitoredCount > 0) {
    return `${monitoredCount} issue${monitoredCount === 1 ? '' : 's'} monitored`
  }

  return narrativeCopy.complete.emptySummary
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

function buildSignalNarrativeEntry(message: string) {
  return buildTimelineEvent('signal', narrativeCopy.signal.title, message)
}

function buildMonitoringNarrativeEntry() {
  return buildTimelineEvent(
    'monitoring',
    narrativeCopy.monitoring.entryTitle,
    narrativeCopy.monitoring.entryDetail,
  )
}

function buildEvaluatingNarrativeEntry() {
  return buildTimelineEvent(
    'evaluating',
    narrativeCopy.evaluating.entryTitle,
    narrativeCopy.evaluating.entryDetail,
  )
}

function getActionEventVisualTone(entry: TimelineEvent) {
  if (entry.type !== 'action') {
    return 'neutral' as const
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
  if (!isSelected) {
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
    return 'shadow-[0_0_36px_-10px_rgba(34,197,94,0.32)] dark:shadow-[0_0_40px_-12px_rgba(34,197,94,0.26)]'
  }

  return 'shadow-[0_0_30px_-10px_rgba(113,113,122,0.28)] dark:shadow-[0_0_34px_-12px_rgba(24,24,27,0.62)]'
}

function getTimelineEventToneClasses(
  entry: TimelineEvent,
  isSelected: boolean,
) {
  const base =
    entry.type === 'signal'
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
            ? getActionEventVisualTone(entry) === 'escalate'
              ? isSelected
                ? 'border-red-300/95 bg-white dark:border-red-400/40 dark:bg-zinc-950'
                : 'border-red-200/65 bg-white dark:border-red-500/18 dark:bg-zinc-950'
              : getActionEventVisualTone(entry) === 'stable'
                ? isSelected
                  ? 'border-green-300/95 bg-white dark:border-green-400/40 dark:bg-zinc-950'
                  : 'border-green-200/65 bg-white dark:border-green-500/18 dark:bg-zinc-950'
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
    return getActionEventVisualTone(entry) === 'escalate'
      ? 'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300'
      : getActionEventVisualTone(entry) === 'stable'
        ? 'bg-green-100 text-green-700 dark:bg-green-500/15 dark:text-green-300'
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
  insightContext: TaskInsightContext
  onSelectSignal: (signalId: string) => void
}) {
  const {
    task,
    signals,
    primarySignal,
    primaryTriage,
    primaryAction,
    isAiPending,
  } = insightContext

  if (entry.type === 'decision') {
    return (
      <div className="space-y-3 border-t border-zinc-200/55 px-4 py-4 dark:border-zinc-800/55">
        <div className="flex flex-wrap gap-2">
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
          {isAiPending ? <DemoBadge color="gray">AI thinking</DemoBadge> : null}
        </div>
        {primarySignal ? (
          <button
            type="button"
            onClick={() => onSelectSignal(primarySignal.id)}
            className="w-full rounded-xl border border-zinc-200/65 bg-zinc-50/80 p-3 text-left transition hover:border-zinc-300/75 hover:bg-zinc-100/80 dark:border-zinc-700/25 dark:bg-zinc-900/40 dark:hover:border-zinc-600/45 dark:hover:bg-zinc-900/60"
          >
            <p className="text-[11px] font-medium tracking-wide text-zinc-500 uppercase dark:text-zinc-400">
              Detected signal
            </p>
            <p className="mt-1 text-sm font-medium text-zinc-900 dark:text-zinc-100">
              {primarySignal.title}
            </p>
            <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
              {primarySignal.summary}
            </p>
          </button>
        ) : null}
        {primaryTriage ? (
          <>
            <div className="rounded-xl border border-zinc-200/65 bg-zinc-50/80 p-3 dark:border-zinc-700/25 dark:bg-zinc-900/40">
              <p className="text-[11px] font-medium tracking-wide text-zinc-500 uppercase dark:text-zinc-400">
                Why the system decided this
              </p>
              <p className="mt-1 text-sm font-medium text-zinc-900 dark:text-zinc-100">
                {primaryTriage.expectationViolated}
              </p>
              <p className="mt-2 text-sm text-zinc-700 dark:text-zinc-300">
                {primaryTriage.reasoning}
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-xl border border-zinc-200/65 bg-zinc-50/80 p-3 dark:border-zinc-700/25 dark:bg-zinc-900/40">
                <p className="text-[11px] font-medium tracking-wide text-zinc-500 uppercase dark:text-zinc-400">
                  Confidence
                </p>
                <p className="mt-1 text-sm font-medium text-zinc-900 dark:text-zinc-100">
                  {Math.round(primaryTriage.confidence * 100)}%
                </p>
              </div>
              <div className="rounded-xl border border-zinc-200/65 bg-zinc-50/80 p-3 dark:border-zinc-700/25 dark:bg-zinc-900/40">
                <p className="text-[11px] font-medium tracking-wide text-zinc-500 uppercase dark:text-zinc-400">
                  Decision source
                </p>
                <p className="mt-1 text-sm text-zinc-700 dark:text-zinc-300">
                  {isAiPending
                    ? 'Waiting on the model response.'
                    : primaryTriage.source === 'fallback'
                      ? 'A fallback rule supplied this decision.'
                      : TRIAGE_MODE === 'pseudo'
                        ? 'A local simulated model supplied this decision.'
                        : 'A live model contributed to this decision.'}
                </p>
              </div>
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
              Related signals
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
                  (entry.title.includes('Escalated')
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
  const actionTriage = entry.eventTriage ?? {
    suggestedRemediation: primaryTriage?.suggestedRemediation,
    guardrailStatus: primaryTriage?.guardrailStatus,
    guardrailReason: primaryTriage?.guardrailReason,
  }
  const actionSummary =
    entry.eventAction ??
    (primaryAction
      ? {
          type: primaryAction.type,
          message: primaryAction.message,
          timestamp: primaryAction.timestamp,
        }
      : null)
  const diffFields =
    beforeSnapshot && afterSnapshot
      ? getChangedTaskSnapshotFields(beforeSnapshot, afterSnapshot)
      : []
  const visibleDiffFields =
    beforeSnapshot && afterSnapshot
      ? getVisibleTaskSnapshotFields(beforeSnapshot, afterSnapshot)
      : (['status', 'owner'] as Array<keyof TaskStateSnapshot>)

  return (
    <div className="space-y-3 border-t border-zinc-200/55 px-4 py-4 dark:border-zinc-800/55">
      {actionTriage ? (
        <>
          <div className="rounded-xl border border-zinc-200/65 bg-zinc-50/80 p-3 dark:border-zinc-700/25 dark:bg-zinc-900/40">
            <p className="text-[11px] font-medium tracking-wide text-zinc-500 uppercase dark:text-zinc-400">
              Suggested next step
            </p>
            <p className="mt-1 text-sm font-medium text-zinc-900 dark:text-zinc-100">
              {actionTriage.suggestedRemediation ??
                'No remediation suggestion recorded.'}
            </p>
          </div>
          <div className="rounded-xl border border-zinc-200/65 bg-zinc-50/80 p-3 dark:border-zinc-700/25 dark:bg-zinc-900/40">
            <div className="flex items-center justify-between gap-3">
              <p className="text-[11px] font-medium tracking-wide text-zinc-500 uppercase dark:text-zinc-400">
                Why this action happened
              </p>
              {actionTriage.guardrailStatus ? (
                <DemoBadge
                  color={guardrailBadgeColor[actionTriage.guardrailStatus]}
                >
                  {guardrailLabel[actionTriage.guardrailStatus]}
                </DemoBadge>
              ) : null}
            </div>
            <p className="mt-1 text-sm text-zinc-700 dark:text-zinc-300">
              {actionTriage.guardrailReason ??
                'No additional action rule was recorded.'}
            </p>
          </div>
        </>
      ) : null}
      <div className="rounded-xl border border-zinc-200/65 bg-zinc-50/80 p-3 dark:border-zinc-700/25 dark:bg-zinc-900/40">
        <p className="text-[11px] font-medium tracking-wide text-zinc-500 uppercase dark:text-zinc-400">
          What happened
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
  const isExpandable =
    (entry.type === 'decision' || entry.type === 'action') &&
    insightContext !== null
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
                <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                  {entry.title}
                </p>
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
                  <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                    {entry.title}
                  </p>
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
  const [recentlyTriagedTaskIds, setRecentlyTriagedTaskIds] = useState<
    string[]
  >([])
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
        top: 0,
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
  const orderedTimelineEvents = useMemo(
    () =>
      [...timelineEvents].sort((left, right) => right.sequence - left.sequence),
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
      orderedTimelineEvents.find(
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
    setAiPendingSignalIds([])
    setUsageSummary(emptyUsageSummary)
    setActiveScanTaskId(null)
    setIsBoardBooting(true)
    setVisibleBoardTaskIds([])
    setBoardRevealQueue(buildBoardRevealQueue(nextSnapshot.tasks))
    setRecentlyTriagedTaskIds([])
    clearTimeline()
    clearNarrativeHeader()
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
    setAiPendingSignalIds([])
    setUsageSummary(emptyUsageSummary)
    setActiveScanTaskId(null)
    setIsBoardBooting(true)
    setVisibleBoardTaskIds([])
    setBoardRevealQueue(buildBoardRevealQueue(nextSnapshot.tasks))
    setRecentlyTriagedTaskIds([])
    clearTimeline()
    clearNarrativeHeader()
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
    setAiPendingSignalIds([])
    setIsBoardBooting(false)
    setVisibleBoardTaskIds([])
    setBoardRevealQueue(buildBoardRevealQueue(runStartSnapshot.tasks))
    setActiveScanTaskId(null)
    setRecentlyTriagedTaskIds([])
    setRecentlyChangedTaskIds([])
    clearTimeline()
    clearNarrativeHeader()
    setNarrativeHeader(buildNarrativeHeader('monitoring'))
    appendTimelineEvent(buildMonitoringNarrativeEntry())
    setIsTriagePassRunning(true)
    void (async () => {
      let workingTasks = runStartSnapshot.tasks.map((task) => ({ ...task }))
      const revealedTaskIds = new Set<string>()
      const burstCount = randomBetween(INCIDENT_BURST_MIN, INCIDENT_BURST_MAX)
      let appliedIncidents = 0
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
          setSnapshot((current) => ({
            ...current,
            tasks: workingTasks,
          }))
          for (const incidentEvent of randomIncidentResult.incidentEvents) {
            revealBoardTask(incidentEvent.taskId)
            revealedTaskIds.add(incidentEvent.taskId)
            await wait(BOARD_REVEAL_BEFORE_SIGNAL_MS)

            if (contextVersionRef.current !== version) {
              return
            }

            setNarrativeHeader({
              title: narrativeCopy.signal.title,
              subtitle: incidentEvent.message,
            })
            appendTimelineEvent(
              buildSignalNarrativeEntry(incidentEvent.message),
            )
          }
        }

        if (burstIndex < burstCount - 1) {
          await wait(
            randomBetween(INCIDENT_STAGGER_MIN_MS, INCIDENT_STAGGER_MAX_MS),
          )
        }
      }

      const remainingRevealTaskIds = workingTasks
        .map((task) => task.id)
        .filter((taskId) => !revealedTaskIds.has(taskId))

      for (const taskId of remainingRevealTaskIds) {
        if (contextVersionRef.current !== version) {
          return
        }

        revealBoardTask(taskId)
        revealedTaskIds.add(taskId)
        await wait(BOARD_REVEAL_BEFORE_EVALUATION_MS)
      }

      setIncidentCount(appliedIncidents)
      setNarrativeHeader(buildNarrativeHeader('evaluating'))
      appendTimelineEvent(buildEvaluatingNarrativeEntry())
      await wait(EVALUATION_DELAY_MS)

      const orderedTaskIds = taskStatusOrder.flatMap((status) =>
        workingTasks
          .filter((task) => task.status === status)
          .map((task) => task.id),
      )

      for (const taskId of orderedTaskIds) {
        if (contextVersionRef.current !== version) {
          return
        }

        setActiveScanTaskId(taskId)
        await wait(SCAN_DELAY_MS)

        if (contextVersionRef.current !== version) {
          return
        }

        const currentTask = workingTasks.find((task) => task.id === taskId)

        if (!currentTask) {
          continue
        }

        const decision = evaluateTaskPassDecision(currentTask)
        if (decision.tone !== 'stable') {
          narrativeDecisions.push({
            decision,
            previousTask: currentTask,
          })
        }
      }

      if (contextVersionRef.current !== version) {
        return
      }

      setActiveScanTaskId(null)

      const projectedTasks = narrativeDecisions.reduce(
        (currentTasks, { decision }) =>
          currentTasks.map((task) =>
            task.id === decision.nextTask.id ? decision.nextTask : task,
          ),
        workingTasks,
      )
      const derivedTimelineState = evaluateTasks(projectedTasks, passLabel)

      for (const { decision } of narrativeDecisions) {
        if (contextVersionRef.current !== version) {
          return
        }

        appendTimelineEvent(
          buildTimelineEvent(
            'decision',
            buildDecisionNarrativeLabel(decision),
            decision.reasoning,
            {
              taskId: decision.nextTask.id,
              signalId: selectFirstSignalForTask(
                {
                  ...runStartSnapshot,
                  tasks: projectedTasks,
                  signals: derivedTimelineState.signals,
                  triage: derivedTimelineState.triage,
                  actions: runStartSnapshot.actions,
                },
                decision.nextTask.id,
              ),
              decisionTone: decision.tone,
              decision,
            },
          ),
        )

        await wait(DECISION_STAGGER_MS)
      }

      await wait(ACTION_PHASE_DELAY_MS)

      for (const { decision, previousTask } of narrativeDecisions) {
        if (contextVersionRef.current !== version) {
          return
        }

        const signalId = selectFirstSignalForTask(
                {
                  ...runStartSnapshot,
                  tasks: projectedTasks,
                  signals: derivedTimelineState.signals,
                  triage: derivedTimelineState.triage,
                  actions: runStartSnapshot.actions,
          },
          decision.nextTask.id,
        )
        const triageForEvent = signalId
          ? derivedTimelineState.triage[signalId]
          : null
        const actionType = deriveTimelineActionType(decision, previousTask)

        workingTasks = workingTasks.map((task) =>
          task.id === decision.nextTask.id ? decision.nextTask : task,
        )
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

        appendTimelineEvent(
          buildTimelineEvent(
            'action',
            buildActionNarrativeLabel(decision, previousTask),
            buildActionNarrativeDetail(decision, previousTask),
            {
              taskId: decision.nextTask.id,
              signalId,
              decisionTone: decision.tone,
              decision,
              previousTask,
              before: captureTaskStateSnapshot(previousTask),
              after: projectTaskStateSnapshotForAction(
                previousTask,
                actionType,
              ),
              eventTriage: triageForEvent
                ? {
                    suggestedRemediation: triageForEvent.suggestedRemediation,
                    guardrailStatus: triageForEvent.guardrailStatus,
                    guardrailReason: triageForEvent.guardrailReason,
                  }
                : undefined,
              eventAction: {
                type: actionType,
                message: buildActionNarrativeDetail(decision, previousTask),
                timestamp: 'During this pass',
              },
            },
          ),
        )

        await wait(ACTION_STAGGER_MS)
      }

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
        buildTimelineEvent(
          'complete',
          narrativeCopy.complete.headerTitle,
          summarizeCompletion(narrativeDecisions.map((item) => item.decision)),
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
                  {TRIAGE_MODE === 'pseudo' ? (
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
                        <span>AI</span>
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
                              Demo mode
                            </p>
                            <p className="text-xs leading-5 text-zinc-600 dark:text-zinc-400">
                              API calls are paused. Signals, guardrails, and
                              action logging still run locally, and identical
                              triage contexts are cached for this session.
                            </p>
                            <div className="flex flex-wrap gap-2">
                              <DemoBadge color="blue">
                                Cache hits {usageSummary.cacheHits}
                              </DemoBadge>
                              <DemoBadge color="yellow">
                                Fallbacks {usageSummary.fallbacks}
                              </DemoBadge>
                            </div>
                          </div>
                        </div>
                      </Transition>
                    </div>
                  ) : null}
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
                      ? 'Running incident simulation'
                      : 'Run incident simulation'
                  }
                  aria-label={
                    isTriagePassRunning || isAnyTriagePending
                      ? 'Running incident simulation'
                      : 'Run incident simulation'
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
                A local deterministic demo that derives signals, triage
                decisions, and action log entries from task state, then hands
                triage judgment
                {TRIAGE_MODE === 'pseudo'
                  ? ' to a local pseudo-AI layer so the UI can be reviewed without model calls.'
                  : ' to a real model with deterministic guardrails.'}
              </p>
            </div>
          </div>
        </div>

        <div className="space-y-6">
          <Panel
            title="Task board"
            description="Tasks are the source of truth. Expectations are checked directly against their current state."
            emphasis="primary"
          >
            <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-4">
              {groupedTasks.map(({ status, tasks }) => {
                const visibleTaskCount = tasks.filter((task) =>
                  visibleBoardTaskIds.includes(task.id),
                ).length
                const displayTaskCount = isTriagePassRunning
                  ? visibleTaskCount
                  : tasks.length

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
                    {(boardRevealQueue[status] ?? []).map((queuedTaskId) => (
                      <TaskCardSkeleton
                        key={`${status}-skeleton-${queuedTaskId}`}
                      />
                    ))}
                    {tasks.map((task) => {
                      const shouldShowTask =
                        !isBoardBooting &&
                        (!isTriagePassRunning ||
                          visibleBoardTaskIds.includes(task.id))
                      const matchingTimelineEvent =
                        findLatestTimelineEventForTask(task.id)

                      return (
                        <Transition
                          key={task.id}
                          as={Fragment}
                          show={shouldShowTask}
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
                  </div>
                  </div>
                )
              })}
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
        <div className="pointer-events-none fixed inset-y-0 right-0 z-40 flex max-w-full pl-10 sm:pl-16">
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
                      onPointerDown={(event) => {
                        event.preventDefault()
                        event.stopPropagation()
                        setIsHistoryOpen(false)
                      }}
                      onMouseDown={(event) => {
                        event.preventDefault()
                        event.stopPropagation()
                        setIsHistoryOpen(false)
                      }}
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
                      {isTriagePassRunning ? (
                        <TimelineLoadingRow
                          title={narrativeHeader?.title}
                          subtitle={narrativeHeader?.subtitle}
                        />
                      ) : null}
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
  isFocused = false,
  focusTone = 'neutral',
  hoverTone = null,
  onClick,
  isActiveScan = false,
  isRecentlyTriaged = false,
  isRecentlyChanged = false,
}: {
  task: DemoTask
  isFocused?: boolean
  focusTone?: TaskFocusTone
  hoverTone?: TaskFocusTone | null
  onClick?: () => void
  isActiveScan?: boolean
  isRecentlyTriaged?: boolean
  isRecentlyChanged?: boolean
}) {
  const isClickable = typeof onClick === 'function'
  const hoverClass =
    isClickable && !isFocused
      ? hoverTone === 'escalate'
        ? 'hover:border-red-300/65 hover:ring-1 hover:ring-red-200/45 dark:hover:border-red-500/25 dark:hover:ring-red-500/12'
        : hoverTone === 'monitor'
          ? 'hover:border-yellow-300/65 hover:ring-1 hover:ring-yellow-200/45 dark:hover:border-yellow-500/25 dark:hover:ring-yellow-500/12'
          : hoverTone === 'stable'
            ? 'hover:border-green-300/65 hover:ring-1 hover:ring-green-200/45 dark:hover:border-green-500/25 dark:hover:ring-green-500/12'
            : 'hover:border-zinc-300/75 hover:ring-1 hover:ring-zinc-300/45 dark:hover:border-zinc-500/45 dark:hover:ring-zinc-500/16'
      : ''

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!isClickable}
      className={`rounded-2xl border bg-white px-4 py-5 shadow-sm transition duration-300 dark:bg-zinc-950/70 ${
        isFocused
          ? focusTone === 'escalate'
            ? 'border-red-300/65 ring-1 ring-red-200/50 dark:border-red-500/25 dark:ring-red-500/12'
            : focusTone === 'monitor'
              ? 'border-yellow-300/65 ring-1 ring-yellow-200/50 dark:border-yellow-500/25 dark:ring-yellow-500/12'
              : focusTone === 'stable'
                ? 'border-green-300/65 ring-1 ring-green-200/50 dark:border-green-500/25 dark:ring-green-500/12'
                : 'border-zinc-300/75 ring-1 ring-zinc-300/50 dark:border-zinc-500/45 dark:ring-zinc-500/18'
          : 'border-zinc-200/65 dark:border-zinc-700/25'
      } ${
        isActiveScan
          ? 'scale-[1.02] ring-2 ring-blue-300/55 dark:ring-blue-400/32'
          : ''
      } ${isRecentlyChanged || isRecentlyTriaged ? 'demo-flicker-ring' : ''} ${
        isClickable ? 'cursor-pointer' : 'cursor-default'
      } ${hoverClass} text-left`}
    >
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
          {task.title}
        </p>
        <Badge color="gray">{task.priority}</Badge>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-2.5">
        <Badge color={task.owner ? 'blue' : 'yellow'}>
          {task.owner ?? 'Unassigned'}
        </Badge>
        {isActiveScan ? <Badge color="blue">Scanning</Badge> : null}
        <span className="text-[11px] font-medium tracking-wide text-zinc-500 uppercase dark:text-zinc-400">
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
