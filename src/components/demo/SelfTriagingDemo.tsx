'use client'

import {
  Disclosure,
  DisclosureButton,
  DisclosurePanel,
  Dialog,
  DialogPanel,
  DialogTitle,
  Transition,
} from '@headlessui/react'
import {
  CheckCircleIcon,
  ChevronDownIcon,
  CpuChipIcon,
  EyeIcon,
  FlagIcon,
  MinusCircleIcon,
  PlayIcon,
  SparklesIcon,
  WrenchScrewdriverIcon,
} from '@heroicons/react/20/solid'
import { XMarkIcon } from '@heroicons/react/24/outline'
import { Fragment, useEffect, useMemo, useRef, useState } from 'react'

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

type ActivityCard = {
  id: string
  taskId: string
  decisionLabel: string
  targetLabel: string
  reasonLabel: string
  outcomeLabel: string
  evidence: string[]
  tone: TaskPassDecision['tone']
}
type TaskFocusTone = 'neutral' | 'escalate' | 'monitor' | 'stable'

const emptyUsageSummary: AiUsageSummary = {
  aiCalls: 0,
  cacheHits: 0,
  fallbacks: 0,
  inputTokens: 0,
  outputTokens: 0,
  totalTokens: 0,
}

const SCAN_DELAY_MS = 600
const INCIDENT_STAGGER_MIN_MS = 600
const INCIDENT_STAGGER_MAX_MS = 900
const INCIDENT_BURST_MIN = 5
const INCIDENT_BURST_MAX = 7
const basePillClass =
  'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium'
const subtlePillClass =
  'inline-flex items-center rounded-full px-2 text-xs'

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
        randomTask((task) => task.status !== 'done' && task.owner !== null, usedTaskIds) ??
        randomTask((task) => task.status !== 'done', usedTaskIds)

      if (!target) continue
      target.owner = null
      if (Math.random() < 0.45 && (target.priority === 'P2' || target.priority === 'P3')) {
        target.priority = Math.random() < 0.5 ? 'P1' : 'P0'
      }
      target.ageLabel = 'Owner dropped just now'
      usedTaskIds.add(target.id)
      continue
    }

    if (incidentType === 'task_overdue') {
      const target =
        randomTask((task) => task.status !== 'done' && task.dueInDays !== null, usedTaskIds) ??
        randomTask((task) => task.status !== 'done', usedTaskIds)

      if (!target) continue
      target.dueInDays = -1 - Math.floor(Math.random() * 4)
      target.daysInStatus = Math.max(target.daysInStatus, 8 + Math.floor(Math.random() * 4))
      if (Math.random() < 0.5 && (target.priority === 'P2' || target.priority === 'P3')) {
        target.priority = 'P0'
      }
      target.ageLabel = 'Overdue just now'
      usedTaskIds.add(target.id)
      continue
    }

    if (incidentType === 'stuck_in_progress') {
      const target =
        randomTask((task) => task.status === 'in_progress', usedTaskIds) ??
        randomTask((task) => task.status !== 'done', usedTaskIds)

      if (!target) continue
      target.status = 'in_progress'
      target.daysInStatus = Math.max(target.daysInStatus, 10 + Math.floor(Math.random() * 4))
      if (Math.random() < 0.55 && target.priority !== 'P0') {
        target.priority = 'P1'
      }
      target.ageLabel = `${target.daysInStatus}d active`
      usedTaskIds.add(target.id)
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
  }

  return {
    tasks: nextTasks,
    incidentCount: Math.min(incidentTypes.length, incidentCount),
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

function buildActivityOutcome(decision: TaskPassDecision, previousTask: DemoTask) {
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

function getActivityCardIcon(activityCard: ActivityCard) {
  if (
    activityCard.outcomeLabel.includes('Moved to') ||
    activityCard.decisionLabel === 'Escalated' ||
    activityCard.decisionLabel === 'Escalation confirmed'
  ) {
    return FlagIcon
  }

  if (activityCard.outcomeLabel === 'Flagged for monitoring') {
    return EyeIcon
  }

  if (activityCard.decisionLabel === 'Auto-fixed') {
    return WrenchScrewdriverIcon
  }

  if (activityCard.outcomeLabel === 'No action') {
    return MinusCircleIcon
  }

  if (activityCard.outcomeLabel === 'State validated') {
    return CheckCircleIcon
  }

  if (activityCard.decisionLabel === 'Stable') {
    return CheckCircleIcon
  }

  if (activityCard.decisionLabel === 'Monitored') {
    return EyeIcon
  }

  return SparklesIcon
}

function renderActivityCardIcon(activityCard: ActivityCard) {
  if (activityCard.outcomeLabel === 'No action') {
    return <MinusCircleIcon className="h-4 w-4" />
  }

  if (
    activityCard.tone === 'escalate' ||
    activityCard.decisionLabel === 'Escalated' ||
    activityCard.decisionLabel === 'Escalation confirmed'
  ) {
    return <FlagIcon className="h-4 w-4" />
  }

  if (activityCard.outcomeLabel === 'State validated') {
    return <CheckCircleIcon className="h-4 w-4" />
  }

  if (activityCard.decisionLabel === 'Stable') {
    return <CheckCircleIcon className="h-4 w-4" />
  }

  if (activityCard.decisionLabel === 'Monitored') {
    return <EyeIcon className="h-4 w-4" />
  }

  return <SparklesIcon className="h-4 w-4" />
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
      signal.taskId === taskId || (signal.relatedTaskIds ?? []).includes(taskId),
  )
  const primarySignal =
    signals.find((signal) => signal.id === selectedSignalId) ?? signals[0] ?? null
  const primaryTriage = primarySignal
    ? effectiveTriage[primarySignal.id]
    : null
  const primaryAction = primarySignal
    ? snapshot.actions.find((action) => action.signalId === primarySignal.id) ??
      null
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

  return insightContext.primarySignal?.title ?? insightContext.signals[0]?.title ?? 'Signal detected'
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

function ActivityCardDetails({
  insightContext,
  onSelectSignal,
  openSection,
  onToggleSection,
}: {
  insightContext: TaskInsightContext
  onSelectSignal: (signalId: string) => void
  openSection: 'signals' | 'triage' | 'remediation' | null
  onToggleSection: (
    section: 'signals' | 'triage' | 'remediation',
  ) => void
}) {
  const { task, signals, primarySignal, primaryTriage, primaryAction, isAiPending } =
    insightContext

  return (
    <>
      <div>
        <button
          type="button"
          onClick={() => onToggleSection('signals')}
          className="flex w-full items-center justify-between gap-4 px-4 py-4 text-left transition hover:bg-zinc-50/60 dark:hover:bg-zinc-900/40"
        >
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
                Signals
              </p>
              <span className="font-mono text-[11px] font-medium uppercase tracking-widest text-zinc-500 dark:text-zinc-400">
                {signals.length === 1 ? '1 active' : `${signals.length} active`}
              </span>
            </div>
            <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
              {buildSignalSummary(insightContext)}
            </p>
          </div>
          <ChevronDownIcon
            aria-hidden="true"
            className={`size-5 shrink-0 text-zinc-400 transition duration-200 dark:text-zinc-500 ${
              openSection === 'signals'
                ? 'rotate-180 text-zinc-600 dark:text-zinc-300'
                : ''
            }`}
          />
        </button>
        {openSection === 'signals' ? (
          <div className="px-4 pb-4">
            {signals.length > 0 ? (
              <div className="space-y-2">
                {signals.map((signal) => (
                  <button
                    key={signal.id}
                    type="button"
                    onClick={() => onSelectSignal(signal.id)}
                    className={`w-full rounded-xl border p-3 text-left transition ${
                      signal.id === primarySignal?.id
                        ? 'border-teal-300/65 bg-teal-50 shadow-[0_0_0_1px_rgba(45,212,191,0.08)] dark:border-teal-500/25 dark:bg-teal-500/10'
                        : 'border-zinc-200/65 bg-zinc-50/80 dark:border-zinc-700/25 dark:bg-zinc-900/50'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <DemoBadge color={signalBadgeColor[signal.kind]}>
                        {signal.kind}
                      </DemoBadge>
                      <span className="text-[11px] font-medium tracking-wide text-zinc-500 uppercase dark:text-zinc-400">
                        {signal.detectedAt}
                      </span>
                    </div>
                    <p className="mt-2 text-sm font-medium text-zinc-900 dark:text-zinc-100">
                      {signal.title}
                    </p>
                    <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
                      {signal.summary}
                    </p>
                  </button>
                ))}
              </div>
            ) : (
              <p className="text-sm text-zinc-600 dark:text-zinc-400">
                No signals were detected for this item.
              </p>
            )}
          </div>
        ) : null}
      </div>

      <div>
        <button
          type="button"
          onClick={() => onToggleSection('triage')}
          className="flex w-full items-center justify-between gap-4 px-4 py-4 text-left transition hover:bg-zinc-50/60 dark:hover:bg-zinc-900/40"
        >
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
                Decision
              </p>
              {primaryTriage ? (
                <DemoBadge
                  color={
                    actionBadgeColor[decisionToActionType[primaryTriage.decision]]
                  }
                >
                  {decisionLabel[primaryTriage.decision]}
                </DemoBadge>
              ) : null}
            </div>
            <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
              {buildDecisionSummary(insightContext)}
            </p>
          </div>
          <ChevronDownIcon
            aria-hidden="true"
            className={`size-5 shrink-0 text-zinc-400 transition duration-200 dark:text-zinc-500 ${
              openSection === 'triage'
                ? 'rotate-180 text-zinc-600 dark:text-zinc-300'
                : ''
            }`}
          />
        </button>
        {openSection === 'triage' ? (
          <div className="px-4 pb-4">
            {primarySignal && primaryTriage ? (
              <div className="space-y-3">
                <div className="flex flex-wrap gap-2">
                  <DemoBadge color={triageSourceBadgeColor[primaryTriage.source]}>
                    {triageSourceLabel[primaryTriage.source]}
                  </DemoBadge>
                  <DemoBadge color={severityBadgeColor[primaryTriage.severity]}>
                    {primaryTriage.severity}
                  </DemoBadge>
                  {isAiPending ? <DemoBadge color="gray">AI thinking</DemoBadge> : null}
                </div>
                <div className="rounded-xl border border-zinc-200/65 bg-zinc-50/80 p-3 dark:border-zinc-700/25 dark:bg-zinc-900/40">
                  <p className="text-[11px] font-medium tracking-wide text-zinc-500 uppercase dark:text-zinc-400">
                    Detected signal
                  </p>
                  <p className="mt-1 text-sm font-medium text-zinc-900 dark:text-zinc-100">
                    {primarySignal.title}
                  </p>
                  <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
                    {primarySignal.summary}
                  </p>
                </div>
                <div className="rounded-xl border border-zinc-200/65 bg-zinc-50/80 p-3 dark:border-zinc-700/25 dark:bg-zinc-900/40">
                  <p className="text-[11px] font-medium tracking-wide text-zinc-500 uppercase dark:text-zinc-400">
                    Why the system decided this
                  </p>
                  <p className="mt-1 text-sm font-medium text-zinc-900 dark:text-zinc-100">
                    {primaryTriage.expectationViolated}
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
                <p className="text-sm text-zinc-700 dark:text-zinc-300">
                  {primaryTriage.reasoning}
                </p>
              </div>
            ) : (
              <p className="text-sm text-zinc-600 dark:text-zinc-400">
                No decision recorded yet.
              </p>
            )}
          </div>
        ) : null}
      </div>

      <div>
        <button
          type="button"
          onClick={() => onToggleSection('remediation')}
          className="flex w-full items-center justify-between gap-4 px-4 py-4 text-left transition hover:bg-zinc-50/60 dark:hover:bg-zinc-900/40"
        >
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
                Action
              </p>
              {primaryTriage?.guardrailStatus ? (
                <Badge color={guardrailBadgeColor[primaryTriage.guardrailStatus]}>
                  {guardrailLabel[primaryTriage.guardrailStatus]}
                </Badge>
              ) : null}
            </div>
            <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
              {buildActionSummary(insightContext)}
            </p>
          </div>
          <ChevronDownIcon
            aria-hidden="true"
            className={`size-5 shrink-0 text-zinc-400 transition duration-200 dark:text-zinc-500 ${
              openSection === 'remediation'
                ? 'rotate-180 text-zinc-600 dark:text-zinc-300'
                : ''
            }`}
          />
        </button>
        {openSection === 'remediation' ? (
          <div className="px-4 pb-4">
            {primarySignal && primaryTriage ? (
              <div className="space-y-3">
                <div className="rounded-xl border border-zinc-200/65 bg-zinc-50/80 p-3 dark:border-zinc-700/25 dark:bg-zinc-900/40">
                  <p className="text-[11px] font-medium tracking-wide text-zinc-500 uppercase dark:text-zinc-400">
                    Suggested next step
                  </p>
                  <p className="mt-1 text-sm font-medium text-zinc-900 dark:text-zinc-100">
                    {primaryTriage.suggestedRemediation ??
                      'No remediation suggestion recorded.'}
                  </p>
                </div>
                <div className="rounded-xl border border-zinc-200/65 bg-zinc-50/80 p-3 dark:border-zinc-700/25 dark:bg-zinc-900/40">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-[11px] font-medium tracking-wide text-zinc-500 uppercase dark:text-zinc-400">
                      Why this action happened
                    </p>
                    {primaryTriage.guardrailStatus ? (
                      <Badge color={guardrailBadgeColor[primaryTriage.guardrailStatus]}>
                        {guardrailLabel[primaryTriage.guardrailStatus]}
                      </Badge>
                    ) : null}
                  </div>
                  <p className="mt-1 text-sm text-zinc-700 dark:text-zinc-300">
                    {primaryTriage.guardrailReason ??
                      'No additional action rule was recorded.'}
                  </p>
                </div>
                <div className="rounded-xl border border-zinc-200/65 bg-zinc-50/80 p-3 dark:border-zinc-700/25 dark:bg-zinc-900/40">
                  <p className="text-[11px] font-medium tracking-wide text-zinc-500 uppercase dark:text-zinc-400">
                    What happened
                  </p>
                  {primaryAction ? (
                    <div className="mt-1 space-y-2">
                      <DemoBadge color={actionBadgeColor[primaryAction.type]}>
                        {primaryAction.type}
                      </DemoBadge>
                      <p className="text-sm text-zinc-700 dark:text-zinc-300">
                        {primaryAction.message}
                      </p>
                      <p className="text-[11px] font-medium tracking-wide text-zinc-500 uppercase dark:text-zinc-400">
                        {primaryAction.timestamp}
                      </p>
                    </div>
                  ) : (
                    <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
                      No resulting change was logged for this item.
                    </p>
                  )}
                </div>
                {task ? (
                  <div className="flex flex-wrap gap-2">
                    <DemoBadge color={statusBadgeColor[task.status]}>
                      {statusLabels[task.status]}
                    </DemoBadge>
                    <DemoBadge color="gray">{task.priority}</DemoBadge>
                    <DemoBadge color={task.owner ? 'blue' : 'yellow'}>
                      {task.owner ?? 'Unassigned'}
                    </DemoBadge>
                  </div>
                ) : null}
              </div>
            ) : (
              <p className="text-sm text-zinc-600 dark:text-zinc-400">
                Action details appear after a signal and decision are available.
              </p>
            )}
          </div>
        ) : null}
      </div>
    </>
  )
}

function HistoryActivityCard({
  activityCard,
  insightContext,
  isSelected,
  isRecent,
  shouldScrollIntoView = false,
  onSelectCard,
  onSelectSignal,
}: {
  activityCard: ActivityCard
  insightContext: TaskInsightContext
  isSelected: boolean
  isRecent: boolean
  shouldScrollIntoView?: boolean
  onSelectCard: () => void
  onSelectSignal: (signalId: string) => void
}) {
  const cardRef = useRef<HTMLDivElement | null>(null)
  const [openSection, setOpenSection] = useState<
    'summary' | 'signals' | 'triage' | 'remediation' | null
  >(isSelected ? 'summary' : null)

  function scrollCardIntoView() {
    window.requestAnimationFrame(() => {
      const card = cardRef.current

      if (!card) {
        return
      }

      const rect = card.getBoundingClientRect()
      const viewportTop = 96
      const viewportBottom = window.innerHeight - 32

      if (rect.top < viewportTop || rect.bottom > viewportBottom) {
        card.scrollIntoView({
          behavior: 'smooth',
          block: 'nearest',
        })
      }
    })
  }

  useEffect(() => {
    if (shouldScrollIntoView) {
      scrollCardIntoView()
    }
  }, [shouldScrollIntoView])

  function toggleSection(
    section: 'summary' | 'signals' | 'triage' | 'remediation',
  ) {
    onSelectCard()
    setOpenSection((current) => (current === section ? null : section))
  }

  return (
    <div
      ref={cardRef}
      className={`overflow-hidden rounded-2xl border shadow-sm ${
        isSelected
          ? activityCard.outcomeLabel === 'No action'
            ? 'border-zinc-300 bg-zinc-50 ring-2 ring-zinc-300/55 dark:border-zinc-500/40 dark:bg-zinc-900/70 dark:ring-zinc-500/22'
            : activityCard.tone === 'escalate'
              ? 'border-red-300 bg-white ring-2 ring-red-200/55 dark:border-red-500/28 dark:bg-zinc-950 dark:ring-red-500/14'
              : activityCard.tone === 'monitor'
                ? 'border-yellow-300 bg-white ring-2 ring-yellow-200/55 dark:border-yellow-500/28 dark:bg-zinc-950 dark:ring-yellow-500/14'
                : 'border-green-300 bg-white ring-2 ring-green-200/55 dark:border-green-500/28 dark:bg-zinc-950 dark:ring-green-500/14'
          : activityCard.outcomeLabel === 'No action'
            ? 'border-zinc-200/65 bg-white text-zinc-900 ring-1 ring-zinc-100/50 dark:border-zinc-700/25 dark:bg-zinc-950 dark:text-zinc-100 dark:ring-white/4'
            : activityCard.tone === 'escalate'
              ? 'border-red-200/65 bg-white text-zinc-900 ring-1 ring-red-100/50 dark:border-red-500/18 dark:bg-zinc-950 dark:text-zinc-100 dark:ring-red-500/8'
              : activityCard.tone === 'monitor'
                ? 'border-yellow-200/65 bg-white text-zinc-900 ring-1 ring-yellow-100/50 dark:border-yellow-500/18 dark:bg-zinc-950 dark:text-zinc-100 dark:ring-yellow-500/8'
                : 'border-green-200/65 bg-white text-zinc-900 ring-1 ring-green-100/50 dark:border-green-500/18 dark:bg-zinc-950 dark:text-zinc-100 dark:ring-green-500/8'
      } ${
        isRecent ? 'demo-flicker-ring' : ''
      } divide-y divide-zinc-200/55 text-left transition dark:divide-zinc-800/55 ${
        activityCard.outcomeLabel === 'No action'
          ? 'hover:shadow-[0_0_0_1px_rgba(161,161,170,0.24),0_0_18px_rgba(161,161,170,0.18),0_16px_36px_rgba(63,63,70,0.18)]'
          : activityCard.tone === 'escalate'
            ? 'hover:shadow-[0_0_0_1px_rgba(248,113,113,0.12),0_12px_28px_rgba(239,68,68,0.14)]'
            : activityCard.tone === 'monitor'
              ? 'hover:shadow-[0_0_0_1px_rgba(250,204,21,0.12),0_12px_28px_rgba(234,179,8,0.14)]'
              : 'hover:shadow-[0_0_0_1px_rgba(34,197,94,0.12),0_12px_28px_rgba(22,163,74,0.14)]'
      }`}
    >
      <div>
        <button
          type="button"
          onClick={() => toggleSection('summary')}
          className="w-full cursor-pointer px-4 py-4 text-left"
        >
          <div className="flex items-start gap-3">
            <div
              className={`mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${
                activityCard.outcomeLabel === 'No action'
                  ? 'bg-zinc-100 text-zinc-600 dark:bg-zinc-900 dark:text-zinc-300'
                  : activityCard.tone === 'escalate'
                    ? 'bg-red-100 text-red-600 dark:bg-red-500/15 dark:text-red-300'
                    : activityCard.tone === 'monitor'
                      ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-500/15 dark:text-yellow-300'
                      : 'bg-green-100 text-green-700 dark:bg-green-500/15 dark:text-green-300'
                  }`}
            >
              {renderActivityCardIcon(activityCard)}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
                    {activityCard.targetLabel}
                  </p>
                  <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
                    {activityCard.decisionLabel}
                  </p>
                </div>
                <ChevronDownIcon
                  aria-hidden="true"
                  className={`size-5 shrink-0 text-zinc-400 transition duration-200 dark:text-zinc-500 ${
                    openSection === 'summary'
                      ? 'rotate-180 text-zinc-600 dark:text-zinc-300'
                      : ''
                  }`}
                />
              </div>
            </div>
          </div>
        </button>
        {openSection === 'summary' ? (
          <div className="px-4 pb-4">
            <p className="font-mono text-[11px] font-medium uppercase tracking-widest text-zinc-500 dark:text-zinc-400">
              Item
            </p>
            <p className="mt-1 text-sm font-medium text-zinc-800 dark:text-zinc-100">
              {activityCard.targetLabel}
            </p>
            <p className="mt-3 font-mono text-[11px] font-medium uppercase tracking-widest text-zinc-500 dark:text-zinc-400">
              What was detected
            </p>
            <p className="mt-1 text-sm leading-6 text-zinc-600 dark:text-zinc-300">
              {activityCard.reasonLabel}
            </p>
            <p className="mt-3 font-mono text-[11px] font-medium uppercase tracking-widest text-zinc-500 dark:text-zinc-400">
              Result
            </p>
            <p className="mt-1 text-sm font-medium text-zinc-700 dark:text-zinc-200">
              {activityCard.outcomeLabel === 'State validated' ||
              activityCard.outcomeLabel === 'No action'
                ? activityCard.outcomeLabel
                : `→ ${activityCard.outcomeLabel}`}
            </p>
            <p className="mt-3 font-mono text-[11px] font-medium uppercase tracking-widest text-zinc-500 dark:text-zinc-400">
              Context
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              {activityCard.evidence.map((evidenceItem) => (
                <span
                  key={`${activityCard.id}-${evidenceItem}`}
                  className={`${subtlePillClass} ${getEvidencePillClass(
                    evidenceItem,
                  )}`}
                >
                  {evidenceItem}
                </span>
              ))}
            </div>
          </div>
        ) : null}
      </div>
      <ActivityCardDetails
        insightContext={insightContext}
        onSelectSignal={onSelectSignal}
        openSection={
          openSection === 'signals' ||
          openSection === 'triage' ||
          openSection === 'remediation'
            ? openSection
            : null
        }
        onToggleSection={(section) => toggleSection(section)}
      />
    </div>
  )
}

export function SelfTriagingDemo() {
  const initialSnapshot = buildDerivedSnapshot(
    cloneSnapshot(baseDemoSnapshot),
    'initial',
  )
  const initialSignalId = getFirstSignalId(initialSnapshot)
  const initialAiTriage =
    TRIAGE_MODE === 'pseudo'
      ? buildPseudoSelectionTriage(initialSnapshot, initialSignalId)
      : {}

  const [snapshot, setSnapshot] = useState<DemoSnapshot>(initialSnapshot)
  const [selectedSignalId, setSelectedSignalId] =
    useState<string>(initialSignalId)
  const [aiTriageBySignalId, setAiTriageBySignalId] =
    useState<Record<string, DemoTriage>>(initialAiTriage)
  const [aiPendingSignalIds, setAiPendingSignalIds] = useState<string[]>([])
  const [usageSummary, setUsageSummary] =
    useState<AiUsageSummary>(emptyUsageSummary)
  const [isTriagePassRunning, setIsTriagePassRunning] = useState(false)
  const [activeScanTaskId, setActiveScanTaskId] = useState<string | null>(null)
  const [recentlyTriagedTaskIds, setRecentlyTriagedTaskIds] = useState<
    string[]
  >([])
  const [activityCards, setActivityCards] = useState<ActivityCard[]>([])
  const [recentActivityCardIds, setRecentActivityCardIds] = useState<string[]>(
    [],
  )
  const [selectedActivityCardId, setSelectedActivityCardId] = useState<
    string | null
  >(null)
  const [scrollToActivityCardId, setScrollToActivityCardId] = useState<
    string | null
  >(null)
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

  const selectedSignal =
    snapshot.signals.find((signal) => signal.id === selectedSignalId) ?? null
  const selectedActivityCard =
    activityCards.find(
      (activityCard) => activityCard.id === selectedActivityCardId,
    ) ?? null
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
    selectedActivityCard?.taskId ??
    selectedTaskId ??
    selectedSignal?.taskId ??
    null
  const activeTaskTone: TaskFocusTone = selectedActivityCard
    ? selectedActivityCard.outcomeLabel === 'No action'
      ? 'neutral'
      : selectedActivityCard.tone
    : selectedTriage
      ? decisionToFocusTone[selectedTriage.decision]
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

  function clearActivityCards() {
    setActivityCards([])
    setRecentActivityCardIds([])
    setSelectedActivityCardId(null)
    setScrollToActivityCardId(null)
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

  function appendActivityCard(activityCard: Omit<ActivityCard, 'id'>) {
    const id = `activity-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const nextActivityCard: ActivityCard = { id, ...activityCard }

    setActivityCards((current) => [...current, nextActivityCard])
    setSelectedActivityCardId(id)
    setSelectedTaskId(nextActivityCard.taskId)
    setRecentActivityCardIds((current) => [...new Set([id, ...current])])
    window.setTimeout(() => {
      setRecentActivityCardIds((current) =>
        current.filter((activityCardId) => activityCardId !== id),
      )
    }, 1400)
  }

  function selectActivityCard(activityCard: ActivityCard) {
    setSelectedActivityCardId(activityCard.id)
    setScrollToActivityCardId(null)
    setSelectedTaskId(activityCard.taskId)

    const matchingSignal = selectSignalForTask(activityCard.taskId)

    setSelectedSignalId(matchingSignal?.id ?? '')
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
    setRecentlyTriagedTaskIds([])
    clearActivityCards()
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
    setRecentlyTriagedTaskIds([])
    clearActivityCards()
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
    setActiveScanTaskId(null)
    setRecentlyTriagedTaskIds([])
    setRecentlyChangedTaskIds([])
    setSelectedActivityCardId(null)
    setIsTriagePassRunning(true)
    void (async () => {
      let workingTasks = runStartSnapshot.tasks.map((task) => ({ ...task }))
      const burstCount = randomBetween(INCIDENT_BURST_MIN, INCIDENT_BURST_MAX)
      let appliedIncidents = 0

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
        }

        if (burstIndex < burstCount - 1) {
          await wait(
            randomBetween(INCIDENT_STAGGER_MIN_MS, INCIDENT_STAGGER_MAX_MS),
          )
        }
      }

      setIncidentCount(appliedIncidents)
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
        workingTasks = workingTasks.map((task) =>
          task.id === taskId ? decision.nextTask : task,
        )

        setSnapshot((current) => ({
          ...current,
          tasks: workingTasks,
        }))
        setRecentlyTriagedTaskIds((current) => [
          ...new Set([taskId, ...current]),
        ])
        window.setTimeout(() => {
          setRecentlyTriagedTaskIds((current) =>
            current.filter((currentTaskId) => currentTaskId !== taskId),
          )
        }, 1400)
        appendActivityCard({
          taskId,
          decisionLabel: decision.title,
          targetLabel: decision.nextTask.title,
          reasonLabel: decision.reasoning,
          outcomeLabel: buildActivityOutcome(decision, currentTask),
          evidence: buildActivityEvidence(decision.nextTask),
          tone: decision.tone,
        })
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
                <h1 className="text-3xl font-semibold tracking-tight text-zinc-900 sm:text-4xl dark:text-zinc-100">
                  Self-triaging todo system
                </h1>
              </div>
              <div className="flex items-center gap-3 self-start sm:pt-1">
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
                      <div className="absolute top-full right-0 z-20 mt-3 w-80 overflow-hidden rounded-2xl border border-zinc-200/65 bg-white/95 shadow-2xl ring-1 ring-zinc-900/4 backdrop-blur dark:border-zinc-700/30 dark:bg-zinc-950/95 dark:ring-white/8">
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
                <button
                  type="button"
                  onClick={() => setIsHistoryOpen(true)}
                  title="Open triage history"
                  aria-label="Open triage history"
                  className="inline-flex cursor-pointer items-center justify-center rounded-xl border border-zinc-200/65 bg-zinc-50/80 px-3 py-2 text-sm font-semibold text-zinc-700 shadow-sm ring-1 ring-zinc-900/4 transition hover:border-zinc-300/75 hover:bg-zinc-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400/60 dark:border-zinc-700/30 dark:bg-zinc-900/50 dark:text-zinc-200 dark:ring-white/8 dark:hover:border-zinc-600/60 dark:hover:bg-zinc-800/80"
                >
                  <CpuChipIcon className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    clearActivityCards()
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
              {groupedTasks.map(({ status, tasks }) => (
                <div
                  key={status}
                  className={`rounded-2xl border p-4 ${statusPanelClasses[status]}`}
                >
                  <div className="mb-4 flex items-center justify-between gap-3">
                    <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                      {statusLabels[status]}
                    </h2>
                    <DemoBadge color={statusBadgeColor[status]}>
                      {tasks.length}
                    </DemoBadge>
                  </div>
                  <div className="space-y-3">
                    {tasks.map((task) => (
                      <TaskCard
                        key={task.id}
                        task={task}
                        isFocused={activeTaskId === task.id}
                        focusTone={activeTaskTone}
                        onClick={() => {
                          setSelectedTaskId(task.id)
                          const nextSignal = selectSignalForTask(task.id)
                          setSelectedSignalId(nextSignal?.id ?? '')
                          const matchingActivityCard =
                            [...activityCards]
                              .reverse()
                              .find((activityCard) => activityCard.taskId === task.id) ??
                            null

                          setSelectedActivityCardId(matchingActivityCard?.id ?? null)
                          setScrollToActivityCardId(matchingActivityCard?.id ?? null)

                          if (matchingActivityCard) {
                            setIsHistoryOpen(true)
                          }
                        }}
                        isActiveScan={activeScanTaskId === task.id}
                        isRecentlyTriaged={recentlyTriagedTaskIds.includes(
                          task.id,
                        )}
                        isRecentlyChanged={recentlyChangedTaskIds.includes(
                          task.id,
                        )}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </Panel>
          <Panel
            title="Triage history"
            description="History is now the inspection surface for signals, triage decisions, and remediation details."
            emphasis="secondary"
          >
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              Board remains the source of truth. Open triage history to inspect
              the full signal to triage to action chain in the current card
              treatment.
            </p>
          </Panel>

        </div>
      </div>
      <Dialog
        open={isHistoryOpen}
        onClose={setIsHistoryOpen}
        className="relative z-40"
      >
        <div className="fixed inset-0 bg-zinc-950/10" />
        <div className="fixed inset-0 overflow-hidden">
          <div className="absolute inset-0 overflow-hidden">
            <div className="pointer-events-none fixed inset-y-0 right-0 flex max-w-full pl-10 sm:pl-16">
              <DialogPanel
                transition
                className="pointer-events-auto w-screen max-w-md transform transition duration-500 ease-in-out data-closed:translate-x-full sm:duration-700"
              >
                <div className="relative flex h-full flex-col overflow-y-auto bg-white shadow-2xl dark:bg-zinc-950">
                  <div className="border-b border-zinc-200/65 bg-zinc-100/90 px-4 py-6 shadow-inner sm:px-6 dark:border-zinc-800/55 dark:bg-zinc-900/90">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-zinc-200/80 text-zinc-700 ring-1 ring-zinc-300/45 dark:bg-zinc-800 dark:text-zinc-200 dark:ring-zinc-700/45">
                          <CpuChipIcon className="h-5 w-5" />
                        </div>
                        <div>
                          <DialogTitle className="text-lg font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
                            Triage history
                          </DialogTitle>
                          <p className="mt-1 max-w-xs text-sm leading-6 text-zinc-600 dark:text-zinc-400">
                            Live decisions from the current session, rendered
                            top down.
                          </p>
                        </div>
                      </div>
                      <div className="ml-3 flex h-7 items-center">
                        <button
                          type="button"
                          onClick={() => setIsHistoryOpen(false)}
                          className="relative z-10 pointer-events-auto rounded-md text-zinc-500 transition hover:text-zinc-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100 dark:focus-visible:outline-zinc-100"
                        >
                          <span className="absolute -inset-2.5" />
                          <span className="sr-only">Close panel</span>
                          <XMarkIcon aria-hidden="true" className="size-6" />
                        </button>
                      </div>
                    </div>
                  </div>
                  <div className="relative flex-1 space-y-3 bg-zinc-50/80 px-4 py-6 sm:px-6 dark:bg-zinc-900/60">
                    {activityCards.length > 0
                      ? [...activityCards].reverse().map((activityCard) => (
                          (() => {
                            const insightContext = buildTaskInsightContext({
                              snapshot,
                              effectiveTriage,
                              aiPendingSignalIds,
                              selectedSignalId,
                              taskId: activityCard.taskId,
                            })

                            return (
                              <HistoryActivityCard
                                key={`${activityCard.id}-${
                                  selectedActivityCardId === activityCard.id
                                    ? 'selected'
                                    : 'idle'
                                }`}
                                activityCard={activityCard}
                                insightContext={insightContext}
                                isSelected={selectedActivityCardId === activityCard.id}
                                isRecent={recentActivityCardIds.includes(
                                  activityCard.id,
                                )}
                                shouldScrollIntoView={
                                  isHistoryOpen &&
                                  scrollToActivityCardId === activityCard.id
                                }
                                onSelectCard={() => selectActivityCard(activityCard)}
                                onSelectSignal={(signalId) => {
                                  setSelectedActivityCardId(activityCard.id)
                                  setScrollToActivityCardId(null)
                                  setSelectedTaskId(activityCard.taskId)
                                  setSelectedSignalId(signalId)
                                }}
                              />
                            )
                          })()
                        ))
                      : Array.from({ length: 5 }).map((_, index) => (
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
                        ))}
                  </div>
                </div>
              </DialogPanel>
            </div>
          </div>
        </div>
      </Dialog>
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
  onClick,
  isActiveScan = false,
  isRecentlyTriaged = false,
  isRecentlyChanged = false,
}: {
  task: DemoTask
  isFocused?: boolean
  focusTone?: TaskFocusTone
  onClick?: () => void
  isActiveScan?: boolean
  isRecentlyTriaged?: boolean
  isRecentlyChanged?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-2xl border bg-white p-4 shadow-sm transition duration-300 dark:bg-zinc-950/70 ${
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
          ? 'scale-[1.02] ring-2 ring-teal-300/55 dark:ring-teal-400/32'
          : ''
      } ${isRecentlyChanged || isRecentlyTriaged ? 'demo-flicker-ring' : ''} cursor-pointer text-left`}
    >
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
          {task.title}
        </p>
        <Badge color="gray">{task.priority}</Badge>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Badge color={task.owner ? 'blue' : 'yellow'}>
          {task.owner ?? 'Unassigned'}
        </Badge>
        {isActiveScan ? <Badge color="softTeal">Scanning</Badge> : null}
        <span className="text-[11px] font-medium tracking-wide text-zinc-500 uppercase dark:text-zinc-400">
          {task.ageLabel}
        </span>
      </div>
    </button>
  )
}
