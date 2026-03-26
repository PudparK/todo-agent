'use client'

import {
  Dialog,
  DialogPanel,
  DialogTitle,
  Popover,
  Transition,
} from '@headlessui/react'
import {
  ArrowPathIcon,
  BeakerIcon,
  CheckCircleIcon,
  ChevronDownIcon,
  CpuChipIcon,
  CubeTransparentIcon,
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
    'border-zinc-200 bg-white dark:border-zinc-700/60 dark:bg-zinc-900/60',
  in_progress:
    'border-blue-200 bg-blue-50/70 dark:border-blue-500/30 dark:bg-blue-500/10',
  done: 'border-green-200 bg-green-50/70 dark:border-green-500/30 dark:bg-green-500/10',
  problematic:
    'border-red-200 bg-red-50/70 dark:border-red-500/30 dark:bg-red-500/10',
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
  deterministic: 'Deterministic baseline',
  ai: 'AI triage',
  fallback: 'Fallback used',
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
  allowed: 'Allowed',
  blocked: 'Blocked',
  not_needed: 'Not needed',
}

const decisionToActionType: Record<TriageDecision, ActionType> = {
  ignore: 'ignored',
  monitor: 'monitored',
  escalate: 'escalated',
  auto_fix: 'auto-fixed',
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

const emptyUsageSummary: AiUsageSummary = {
  aiCalls: 0,
  cacheHits: 0,
  fallbacks: 0,
  inputTokens: 0,
  outputTokens: 0,
  totalTokens: 0,
}

const SCAN_DELAY_MS = 600
const basePillClass =
  'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium'

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
    <Badge color={color} customStyles={basePillClass}>
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
    return 'border-yellow-300 bg-yellow-50 text-yellow-700 dark:border-yellow-500/30 dark:bg-yellow-500/10 dark:text-yellow-300'
  }

  if (evidenceItem === 'No owner') {
    return 'border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300'
  }

  if (
    evidenceItem.includes('Priority P0') ||
    evidenceItem.includes('Priority P1')
  ) {
    return 'border-rose-300 bg-rose-50 text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300'
  }

  if (evidenceItem.includes('Priority')) {
    return 'border-blue-300 bg-blue-50 text-blue-700 dark:border-blue-500/30 dark:bg-blue-500/10 dark:text-blue-300'
  }

  if (
    evidenceItem.includes('In progress') ||
    evidenceItem.includes('Queued in backlog')
  ) {
    return 'border-indigo-300 bg-indigo-50 text-indigo-700 dark:border-indigo-500/30 dark:bg-indigo-500/10 dark:text-indigo-300'
  }

  if (evidenceItem === 'Completed today') {
    return 'border-green-300 bg-green-50 text-green-700 dark:border-green-500/30 dark:bg-green-500/10 dark:text-green-300'
  }

  if (evidenceItem === 'Problematic state') {
    return 'border-red-300 bg-red-50 text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300'
  }

  return 'border-zinc-200 bg-zinc-100 text-zinc-600 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300'
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
  const [isHistoryOpen, setIsHistoryOpen] = useState(false)
  const [recentlyChangedTaskIds, setRecentlyChangedTaskIds] = useState<
    string[]
  >([])
  const [recentlyChangedSignalIds, setRecentlyChangedSignalIds] = useState<
    string[]
  >([])
  const [triagePulseKey, setTriagePulseKey] = useState(0)
  const [triagePassCount, setTriagePassCount] = useState(1)
  const [incidentCount, setIncidentCount] = useState(0)
  const contextVersionRef = useRef(0)
  const aiTriageCacheRef = useRef<Map<string, DemoTriage>>(new Map())
  const usageSummaryRef = useRef(usageSummary)
  const previousSnapshotRef = useRef<DemoSnapshot | null>(null)
  const previousSelectedSignalIdRef = useRef<string>(initialSignalId)
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

    const changedSignalIds = snapshot.signals
      .filter((signal) => {
        const previousSignal = previousSnapshot.signals.find(
          (item) => item.id === signal.id,
        )

        return (
          !previousSignal ||
          JSON.stringify(previousSignal) !== JSON.stringify(signal)
        )
      })
      .map((signal) => signal.id)

    if (changedTaskIds.length > 0) {
      setRecentlyChangedTaskIds(changedTaskIds)
      window.setTimeout(() => setRecentlyChangedTaskIds([]), 1400)
    }

    if (changedSignalIds.length > 0) {
      setRecentlyChangedSignalIds(changedSignalIds)
      window.setTimeout(() => setRecentlyChangedSignalIds([]), 1400)
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
  const selectedTask = selectedSignal
    ? findTaskById(snapshot, selectedSignal.taskId)
    : null
  const selectedRelatedTaskIds = selectedSignal?.relatedTaskIds ?? []
  const selectedTaskRoleById = new Map<string, 'source' | 'related'>()

  if (selectedSignal) {
    selectedTaskRoleById.set(selectedSignal.taskId, 'source')

    for (const relatedTaskId of selectedRelatedTaskIds) {
      if (!selectedTaskRoleById.has(relatedTaskId)) {
        selectedTaskRoleById.set(relatedTaskId, 'related')
      }
    }
  } else if (selectedActivityCard) {
    selectedTaskRoleById.set(selectedActivityCard.taskId, 'source')
  }
  const selectedActions = selectedSignal
    ? snapshot.actions.filter((action) => action.signalId === selectedSignal.id)
    : []
  const selectedAction = selectedActions[0] ?? null
  const isSelectedSignalAiPending = selectedSignal
    ? aiPendingSignalIds.includes(selectedSignal.id)
    : false
  const isAnyTriagePending = aiPendingSignalIds.length > 0
  const shouldPulseTriage =
    triagePulseKey > 0 ||
    (selectedSignal
      ? recentlyChangedSignalIds.includes(selectedSignal.id)
      : false)

  const groupedTasks = useMemo(
    () =>
      taskStatusOrder.map((status) => ({
        status,
        tasks: snapshot.tasks.filter((task) => task.status === status),
      })),
    [snapshot.tasks],
  )

  useEffect(() => {
    if (previousSelectedSignalIdRef.current !== selectedSignalId) {
      setTriagePulseKey((current) => current + 1)
      window.setTimeout(() => setTriagePulseKey(0), 1200)
      previousSelectedSignalIdRef.current = selectedSignalId
    }
  }, [selectedSignalId])

  function clearActivityCards() {
    setActivityCards([])
    setRecentActivityCardIds([])
    setSelectedActivityCardId(null)
  }

  function appendActivityCard(activityCard: Omit<ActivityCard, 'id'>) {
    const id = `activity-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const nextActivityCard: ActivityCard = { id, ...activityCard }

    setActivityCards((current) => [...current, nextActivityCard])
    setRecentActivityCardIds((current) => [...new Set([id, ...current])])
    window.setTimeout(() => {
      setRecentActivityCardIds((current) =>
        current.filter((activityCardId) => activityCardId !== id),
      )
    }, 1400)
  }

  function selectActivityCard(activityCard: ActivityCard) {
    setSelectedActivityCardId(activityCard.id)

    const matchingSignal = snapshot.signals.find(
      (signal) => signal.taskId === activityCard.taskId,
    )

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

  function triggerRandomIncident() {
    if (isTriagePassRunning) {
      return
    }

    const targetTask =
      snapshot.tasks.find((task) => task.status === 'in_progress') ??
      snapshot.tasks.find((task) => task.status === 'backlog') ??
      snapshot.tasks[0]

    if (!targetTask) {
      return
    }

    contextVersionRef.current += 1
    const version = contextVersionRef.current
    const nextIncidentCount = incidentCount + 1
    const incidentLabel = `incident-${nextIncidentCount}`
    const mutatedTasks = snapshot.tasks.map<DemoTask>((task) =>
      task.id === targetTask.id
        ? {
            ...task,
            owner: null,
            status: 'problematic',
            dueInDays: -2,
            daysInStatus: task.daysInStatus + 4,
            ageLabel: 'Escalated just now',
          }
        : task,
    )
    const derived = evaluateTasks(mutatedTasks, incidentLabel)
    const incidentSignal =
      derived.signals.find((signal) => signal.taskId === targetTask.id) ??
      derived.signals[0]

    const nextSnapshot: DemoSnapshot = {
      tasks: mutatedTasks,
      signals: derived.signals,
      triage: derived.triage,
      actions: snapshot.actions,
    }

    setAiTriageBySignalId({})
    setAiPendingSignalIds([])
    setSnapshot(nextSnapshot)
    setSelectedSignalId(selectFirstSignalForTask(nextSnapshot, targetTask.id))
    setIncidentCount(nextIncidentCount)

    if (incidentSignal) {
      void requestAiTriage(nextSnapshot, [incidentSignal.id], {
        applyActions: true,
        actionPassLabel: incidentLabel,
        seedActions: snapshot.actions,
        version,
      })
    }
  }

  function runTriagePass() {
    if (isTriagePassRunning) {
      return
    }

    contextVersionRef.current += 1
    const version = contextVersionRef.current
    const nextPassCount = triagePassCount + 1
    const passLabel = `pass-${nextPassCount}`
    const orderedTaskIds = taskStatusOrder.flatMap((status) =>
      snapshot.tasks
        .filter((task) => task.status === status)
        .map((task) => task.id),
    )
    const startingTasks = snapshot.tasks.map((task) => ({ ...task }))

    setIsTriagePassRunning(true)
    void (async () => {
      let workingTasks = startingTasks

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
    <section className="relative rounded-3xl border border-zinc-200 bg-white/85 p-6 shadow-sm ring-1 ring-zinc-900/5 dark:border-zinc-700/40 dark:bg-zinc-900/75 dark:ring-white/10">
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
                    className={`${basePillClass} border-teal-500/20 bg-teal-500/10 text-teal-700 dark:border-teal-400/20 dark:bg-teal-400/10 dark:text-teal-300`}
                  >
                    <span>AI paused</span>
                  </div>
                ) : null}
                <button
                  type="button"
                  onClick={() => setIsHistoryOpen(true)}
                  className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-zinc-200 bg-zinc-50/80 px-3 py-2 text-sm font-semibold text-zinc-700 shadow-sm ring-1 ring-zinc-900/5 transition hover:border-zinc-300 hover:bg-zinc-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400/60 dark:border-zinc-700/50 dark:bg-zinc-900/50 dark:text-zinc-200 dark:ring-white/10 dark:hover:border-zinc-600 dark:hover:bg-zinc-800/80"
                >
                  <CpuChipIcon className="h-4 w-4" />
                  <span>History</span>
                </button>
                <Popover className="relative">
                  {({ open, close }) => (
                    <>
                      <Popover.Button className="inline-flex cursor-pointer items-center gap-1.5 rounded-xl border border-zinc-200 bg-zinc-50/80 px-3 py-2 text-sm font-semibold text-zinc-700 shadow-sm ring-1 ring-zinc-900/5 transition hover:border-zinc-300 hover:bg-zinc-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400/60 dark:border-zinc-700/50 dark:bg-zinc-900/50 dark:text-zinc-200 dark:ring-white/10 dark:hover:border-zinc-600 dark:hover:bg-zinc-800/80">
                        <span>Controls</span>
                        <ChevronDownIcon
                          className={`h-4 w-4 transition-transform duration-200 ${
                            open
                              ? 'rotate-180'
                              : 'text-zinc-500 dark:text-zinc-400'
                          }`}
                        />
                      </Popover.Button>
                      <Transition
                        as={Fragment}
                        enter="transition ease-out duration-200"
                        enterFrom="opacity-0 translate-y-1"
                        enterTo="opacity-100 translate-y-0"
                        leave="transition ease-in duration-150"
                        leaveFrom="opacity-100 translate-y-0"
                        leaveTo="opacity-0 translate-y-1"
                      >
                        <Popover.Panel className="absolute top-full right-0 z-20 mt-3 w-80 overflow-hidden rounded-2xl border border-zinc-200 bg-white/95 shadow-2xl ring-1 ring-zinc-900/5 backdrop-blur dark:border-zinc-700/50 dark:bg-zinc-950/95 dark:ring-white/10">
                          <div className="space-y-4 border-b border-zinc-200 bg-zinc-50/70 p-4 dark:border-zinc-800 dark:bg-zinc-900/70">
                            <button
                              type="button"
                              onClick={() => {
                                clearActivityCards()
                                setIsHistoryOpen(true)
                                runTriagePass()
                                close()
                              }}
                              disabled={isTriagePassRunning}
                              className="flex w-full cursor-pointer items-center justify-between rounded-xl border border-teal-500/30 bg-teal-500 px-4 py-3 text-left text-sm font-semibold text-zinc-950 transition hover:bg-teal-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-400/60 disabled:cursor-default disabled:opacity-55 dark:border-teal-400/30 dark:bg-teal-500 dark:text-zinc-950 dark:hover:bg-teal-400"
                            >
                              <div>
                                <p>
                                  {isTriagePassRunning || isAnyTriagePending
                                    ? 'Running triage...'
                                    : 'Run triage pass'}
                                </p>
                                <p className="mt-1 text-xs font-medium text-zinc-300 dark:text-teal-950/80">
                                  Execute deterministic signal analysis.
                                </p>
                              </div>
                              <PlayIcon
                                className={`h-5 w-5 ${
                                  isTriagePassRunning || isAnyTriagePending
                                    ? 'animate-pulse'
                                    : ''
                                }`}
                              />
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                clearActivityCards()
                                triggerRandomIncident()
                                close()
                              }}
                              disabled={isTriagePassRunning}
                              className="flex w-full cursor-pointer items-center justify-between rounded-xl border border-red-500/30 bg-red-500/12 px-4 py-3 text-left text-sm font-semibold text-red-700 transition hover:border-red-500/45 hover:bg-red-500/18 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-400/60 disabled:cursor-default disabled:opacity-55 dark:border-red-500/25 dark:bg-red-500/12 dark:text-red-300 dark:hover:border-red-500/40 dark:hover:bg-red-500/16"
                            >
                              <div>
                                <p>Trigger random incident</p>
                                <p className="mt-1 text-xs font-medium text-red-600/80 dark:text-red-300/80">
                                  Inject a high-priority chaotic state.
                                </p>
                              </div>
                              <CubeTransparentIcon className="h-5 w-5" />
                            </button>
                          </div>
                          <div className="space-y-4 bg-zinc-100/80 p-4 dark:bg-zinc-900/40">
                            <div className="grid grid-cols-2 gap-2">
                              <button
                                type="button"
                                onClick={() => {
                                  clearActivityCards()
                                  resetDemo()
                                  close()
                                }}
                                disabled={isTriagePassRunning}
                                className="inline-flex cursor-pointer items-center justify-center gap-2 rounded-lg px-3 py-2 text-xs font-medium text-zinc-600 transition hover:bg-white hover:text-zinc-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400/60 disabled:cursor-default disabled:opacity-50 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
                              >
                                <ArrowPathIcon className="h-4 w-4" />
                                <span>Reset demo</span>
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  clearActivityCards()
                                  seedWeirdData()
                                  close()
                                }}
                                disabled={isTriagePassRunning}
                                className="inline-flex cursor-pointer items-center justify-center gap-2 rounded-lg px-3 py-2 text-xs font-medium text-zinc-600 transition hover:bg-white hover:text-zinc-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400/60 disabled:cursor-default disabled:opacity-50 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
                              >
                                <BeakerIcon className="h-4 w-4" />
                                <span>Seed weird data</span>
                              </button>
                            </div>
                            {TRIAGE_MODE === 'pseudo' ? (
                              <div className="space-y-2 rounded-xl border border-zinc-200/80 bg-white/70 p-3 dark:border-zinc-800 dark:bg-zinc-950/40">
                                <p className="text-xs font-medium tracking-[0.16em] text-zinc-500 uppercase dark:text-zinc-400">
                                  Demo mode
                                </p>
                                <p className="text-xs leading-5 text-zinc-600 dark:text-zinc-400">
                                  API calls are paused. Signals, guardrails, and
                                  action logging still run locally, and
                                  identical triage contexts are cached for this
                                  session.
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
                            ) : null}
                          </div>
                        </Popover.Panel>
                      </Transition>
                    </>
                  )}
                </Popover>
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
                        highlightRole={selectedTaskRoleById.get(task.id)}
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

          <div className="grid gap-6 xl:grid-cols-2">
            <Panel
              title="Signal feed"
              description="Signals are detected from task state using deterministic local rules."
              emphasis="secondary"
            >
              <div className="space-y-3">
                {snapshot.signals.map((signal) => {
                  const isSelected = signal.id === selectedSignalId
                  const task = findTaskById(snapshot, signal.taskId)

                  return (
                    <button
                      key={signal.id}
                      type="button"
                      onClick={() => {
                        setSelectedActivityCardId(null)
                        setSelectedSignalId(signal.id)
                      }}
                      className={`w-full cursor-pointer rounded-2xl border p-4 text-left transition ${
                        isSelected
                          ? 'border-teal-300 bg-teal-50/70 dark:border-teal-500/40 dark:bg-teal-500/10'
                          : 'border-zinc-200 bg-white hover:border-zinc-300 dark:border-zinc-700/40 dark:bg-zinc-950/40 dark:hover:border-zinc-600'
                      } ${recentlyChangedSignalIds.includes(signal.id) ? 'demo-flicker-ring' : ''}`}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2">
                          <DemoBadge color={signalBadgeColor[signal.kind]}>
                            {signal.kind}
                          </DemoBadge>
                          {isSelected ? (
                            <DemoBadge color="softTeal">Selected</DemoBadge>
                          ) : null}
                        </div>
                        <span className="text-[11px] font-medium tracking-wide text-zinc-500 uppercase dark:text-zinc-400">
                          {signal.detectedAt}
                        </span>
                      </div>
                      <p className="mt-3 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                        {signal.title}
                      </p>
                      <p className="mt-2 text-sm leading-6 text-zinc-600 dark:text-zinc-400">
                        {signal.summary}
                      </p>
                      {task ? (
                        <p className="mt-3 text-[11px] font-medium tracking-wide text-zinc-500 uppercase dark:text-zinc-400">
                          Task: {task.title}
                        </p>
                      ) : null}
                    </button>
                  )
                })}
              </div>
            </Panel>

            <Panel
              title="Triage panel"
              description="Each detected signal gets a deterministic triage decision and reasoning summary."
              emphasis="secondary"
            >
              {selectedSignal && selectedTriage ? (
                <div className="space-y-5">
                  <div
                    className={`rounded-2xl border border-teal-200 bg-teal-50/70 p-4 dark:border-teal-500/30 dark:bg-teal-500/10 ${shouldPulseTriage ? 'demo-flicker-ring' : ''}`}
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <DemoBadge color="gray">Source task</DemoBadge>
                      {selectedTask ? (
                        <DemoBadge color={statusBadgeColor[selectedTask.status]}>
                          {statusLabels[selectedTask.status]}
                        </DemoBadge>
                      ) : null}
                      <DemoBadge color={signalBadgeColor[selectedSignal.kind]}>
                        {selectedSignal.kind}
                      </DemoBadge>
                      <DemoBadge
                        color={
                          actionBadgeColor[
                            decisionToActionType[selectedTriage.decision]
                          ]
                        }
                      >
                        {decisionLabel[selectedTriage.decision]}
                      </DemoBadge>
                      <DemoBadge
                        color={triageSourceBadgeColor[selectedTriage.source]}
                      >
                        {triageSourceLabel[selectedTriage.source]}
                      </DemoBadge>
                      {isSelectedSignalAiPending ? (
                        <DemoBadge color="gray">AI thinking</DemoBadge>
                      ) : null}
                    </div>
                    <div className="mt-3 space-y-2 text-sm">
                      <SummaryStep
                        label="Task"
                        value={selectedTask?.title ?? 'Unknown task'}
                      />
                      <SummaryArrow />
                      <SummaryStep
                        label="Expectation"
                        value={selectedTriage.expectationViolated}
                      />
                      <SummaryArrow />
                      <SummaryStep label="Signal" value={selectedSignal.kind} />
                      <SummaryArrow />
                      <SummaryStep
                        label="Decision"
                        value={decisionLabel[selectedTriage.decision]}
                      />
                      <SummaryArrow />
                      <SummaryStep
                        label="Action"
                        value={selectedAction?.type ?? 'No action yet'}
                      />
                    </div>
                  </div>

                  <div className="rounded-2xl border border-zinc-200 bg-zinc-50/80 p-4 dark:border-zinc-700/40 dark:bg-zinc-950/40">
                    <div className="flex items-center justify-between gap-3">
                      <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                        {selectedSignal.title}
                      </h2>
                      <DemoBadge color={signalBadgeColor[selectedSignal.kind]}>
                        {selectedSignal.kind}
                      </DemoBadge>
                    </div>
                    <p className="mt-2 text-sm leading-6 text-zinc-600 dark:text-zinc-400">
                      {selectedSignal.summary}
                    </p>
                    {selectedTask ? (
                      <div className="mt-4 flex flex-wrap items-center gap-2">
                        <DemoBadge color={statusBadgeColor[selectedTask.status]}>
                          {statusLabels[selectedTask.status]}
                        </DemoBadge>
                        <DemoBadge color="gray">{selectedTask.priority}</DemoBadge>
                        <DemoBadge color="softTeal">Source task</DemoBadge>
                        {selectedRelatedTaskIds.length > 0 ? (
                          <DemoBadge color="purple">
                            {selectedRelatedTaskIds.length} duplicate match
                            {selectedRelatedTaskIds.length > 1 ? 'es' : ''}
                          </DemoBadge>
                        ) : null}
                        <span className="text-sm text-zinc-600 dark:text-zinc-400">
                          {selectedTask.title}
                        </span>
                      </div>
                    ) : null}
                    <div className="mt-4 rounded-xl border border-zinc-200/80 bg-white/80 p-3 dark:border-zinc-700/40 dark:bg-zinc-900/60">
                      <p className="text-[11px] font-medium tracking-wide text-zinc-500 uppercase dark:text-zinc-400">
                        Violated expectation
                      </p>
                      <p className="mt-1 text-sm font-medium text-zinc-900 dark:text-zinc-100">
                        {selectedTriage.expectationViolated}
                      </p>
                    </div>
                    <div className="mt-3 grid gap-3 sm:grid-cols-2">
                      <div className="rounded-xl border border-zinc-200/80 bg-white/80 p-3 dark:border-zinc-700/40 dark:bg-zinc-900/60">
                        <p className="text-[11px] font-medium tracking-wide text-zinc-500 uppercase dark:text-zinc-400">
                          AI suggested remediation
                        </p>
                        <p className="mt-1 text-sm font-medium text-zinc-900 dark:text-zinc-100">
                          {selectedTriage.suggestedRemediation ??
                            'No AI remediation suggestion yet.'}
                        </p>
                      </div>
                      <div className="rounded-xl border border-zinc-200/80 bg-white/80 p-3 dark:border-zinc-700/40 dark:bg-zinc-900/60">
                        <div className="flex items-center justify-between gap-3">
                          <p className="text-[11px] font-medium tracking-wide text-zinc-500 uppercase dark:text-zinc-400">
                            Guardrail result
                          </p>
                          {selectedTriage.guardrailStatus ? (
                            <Badge
                              color={
                                guardrailBadgeColor[
                                  selectedTriage.guardrailStatus
                                ]
                              }
                            >
                              {guardrailLabel[selectedTriage.guardrailStatus]}
                            </Badge>
                          ) : null}
                        </div>
                        <p className="mt-1 text-sm font-medium text-zinc-900 dark:text-zinc-100">
                          {selectedTriage.guardrailReason ??
                            'No guardrail decision recorded yet.'}
                        </p>
                      </div>
                    </div>
                  </div>

                  <dl className="grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-[minmax(0,11rem)_1fr]">
                    <DetailRow
                      label="Expectation violated"
                      value={selectedTriage.expectationViolated}
                    />
                    <DetailRow
                      label="Severity"
                      value={
                        <DemoBadge
                          color={severityBadgeColor[selectedTriage.severity]}
                        >
                          {selectedTriage.severity}
                        </DemoBadge>
                      }
                    />
                    <DetailRow
                      label="Confidence"
                      value={`${Math.round(selectedTriage.confidence * 100)}%`}
                    />
                    <DetailRow
                      label="Decision"
                      value={
                        <div className="flex flex-wrap items-center gap-2">
                          <DemoBadge
                            color={
                              actionBadgeColor[
                                decisionToActionType[selectedTriage.decision]
                              ]
                            }
                          >
                            {decisionLabel[selectedTriage.decision]}
                          </DemoBadge>
                          {selectedTriage.aiDecision &&
                          selectedTriage.aiDecision !==
                            selectedTriage.decision ? (
                            <DemoBadge color="yellow">
                              AI suggested{' '}
                              {decisionLabel[selectedTriage.aiDecision]}
                            </DemoBadge>
                          ) : null}
                        </div>
                      }
                    />
                    <DetailRow
                      label="AI participation"
                      value={
                        <div className="flex flex-wrap items-center gap-2">
                          <DemoBadge
                            color={
                              triageSourceBadgeColor[selectedTriage.source]
                            }
                          >
                            {triageSourceLabel[selectedTriage.source]}
                          </DemoBadge>
                          {isSelectedSignalAiPending ? (
                            <span>Waiting on the model response.</span>
                          ) : selectedTriage.source === 'fallback' ? (
                            <span>
                              The demo fell back to deterministic triage.
                            </span>
                          ) : TRIAGE_MODE === 'pseudo' ? (
                            <span>
                              The demo is using local pseudo-AI behavior instead
                              of live model calls.
                            </span>
                          ) : (
                            <span>
                              The model contributed the judgment call for this
                              signal.
                            </span>
                          )}
                        </div>
                      }
                    />
                    <DetailRow
                      label="Reasoning summary"
                      value={selectedTriage.reasoning}
                    />
                  </dl>
                </div>
              ) : (
                <p className="text-sm text-zinc-600 dark:text-zinc-400">
                  No signal selected.
                </p>
              )}
            </Panel>
          </div>

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
                  <div className="border-b border-teal-400/20 bg-linear-to-br from-teal-600 via-teal-500 to-cyan-500 px-4 py-6 shadow-inner sm:px-6 dark:from-teal-500 dark:via-teal-400 dark:to-cyan-400">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-zinc-950/12 text-white ring-1 ring-white/20">
                          <CpuChipIcon className="h-5 w-5" />
                        </div>
                        <div>
                          <DialogTitle className="text-lg font-semibold tracking-tight text-white">
                            Triage history
                          </DialogTitle>
                          <p className="mt-1 max-w-xs text-sm leading-6 text-teal-50/90">
                            Live decisions from the current session, rendered
                            top down.
                          </p>
                        </div>
                      </div>
                      <div className="ml-3 flex h-7 items-center">
                        <button
                          type="button"
                          onClick={() => setIsHistoryOpen(false)}
                          className="relative rounded-md text-teal-100 transition hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
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
                      ? activityCards.map((activityCard) => (
                          (() => {
                            const ActivityIcon = getActivityCardIcon(activityCard)

                            return (
                          <button
                            key={activityCard.id}
                            type="button"
                            onClick={() => selectActivityCard(activityCard)}
                            className={`rounded-2xl border p-4 shadow-sm ${
                              selectedActivityCardId === activityCard.id
                                ? 'border-teal-300 bg-teal-50 ring-2 ring-teal-200 dark:border-teal-400/40 dark:bg-teal-500/10 dark:ring-teal-500/20'
                                : ''
                            } ${
                              activityCard.outcomeLabel === 'No action'
                                ? 'border-zinc-200 bg-white text-zinc-900 ring-1 ring-zinc-100 dark:border-zinc-700/40 dark:bg-zinc-950 dark:text-zinc-100 dark:ring-white/5'
                                : activityCard.tone === 'escalate'
                                ? 'border-red-200 bg-white text-zinc-900 ring-1 ring-red-100 dark:border-red-500/25 dark:bg-zinc-950 dark:text-zinc-100 dark:ring-red-500/10'
                                : activityCard.tone === 'monitor'
                                  ? 'border-yellow-200 bg-white text-zinc-900 ring-1 ring-yellow-100 dark:border-yellow-500/25 dark:bg-zinc-950 dark:text-zinc-100 dark:ring-yellow-500/10'
                                  : 'border-green-200 bg-white text-zinc-900 ring-1 ring-green-100 dark:border-green-500/25 dark:bg-zinc-950 dark:text-zinc-100 dark:ring-green-500/10'
                            } cursor-pointer ${
                              recentActivityCardIds.includes(activityCard.id)
                                ? 'demo-flicker-ring'
                                : ''
                            } text-left transition ${
                              activityCard.outcomeLabel === 'No action'
                                ? 'hover:shadow-[0_0_0_1px_rgba(161,161,170,0.24),0_0_18px_rgba(161,161,170,0.18),0_16px_36px_rgba(63,63,70,0.18)]'
                                : activityCard.tone === 'escalate'
                                ? 'hover:shadow-[0_0_0_1px_rgba(248,113,113,0.12),0_12px_28px_rgba(239,68,68,0.14)]'
                                : activityCard.tone === 'monitor'
                                  ? 'hover:shadow-[0_0_0_1px_rgba(250,204,21,0.12),0_12px_28px_rgba(234,179,8,0.14)]'
                                  : 'hover:shadow-[0_0_0_1px_rgba(34,197,94,0.12),0_12px_28px_rgba(22,163,74,0.14)]'
                            }`}
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
                                <ActivityIcon className="h-4 w-4" />
                              </div>
                            <div className="min-w-0 flex-1">
                              <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
                                {activityCard.decisionLabel}
                              </p>
                              <p className="mt-3 font-mono text-[11px] font-medium uppercase tracking-widest text-zinc-500 dark:text-zinc-400">
                                Target
                              </p>
                              <p className="mt-1 text-sm font-medium text-zinc-800 dark:text-zinc-100">
                                {activityCard.targetLabel}
                              </p>
                              <p className="mt-3 font-mono text-[11px] font-medium uppercase tracking-widest text-zinc-500 dark:text-zinc-400">
                                Reason
                              </p>
                              <p className="mt-1 text-sm leading-6 text-zinc-600 dark:text-zinc-300">
                                {activityCard.reasonLabel}
                              </p>
                              <p className="mt-3 font-mono text-[11px] font-medium uppercase tracking-widest text-zinc-500 dark:text-zinc-400">
                                Outcome
                              </p>
                              <p className="mt-1 text-sm font-medium text-zinc-700 dark:text-zinc-200">
                                {activityCard.outcomeLabel === 'State validated' ||
                                activityCard.outcomeLabel === 'No action'
                                  ? activityCard.outcomeLabel
                                  : `→ ${activityCard.outcomeLabel}`}
                              </p>
                              <p className="mt-3 font-mono text-[11px] font-medium uppercase tracking-widest text-zinc-500 dark:text-zinc-400">
                                Telemetry
                              </p>
                              <div className="mt-2 flex flex-wrap gap-2">
                                {activityCard.evidence.map((evidenceItem) => (
                                  <span
                                    key={`${activityCard.id}-${evidenceItem}`}
                                    className={`${basePillClass} ${getEvidencePillClass(
                                      evidenceItem,
                                    )}`}
                                  >
                                    {evidenceItem}
                                  </span>
                                ))}
                              </div>
                            </div>
                          </div>
                        </button>
                            )
                          })()
                        ))
                      : Array.from({ length: 5 }).map((_, index) => (
                          <div
                            key={`history-skeleton-${index}`}
                            className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm ring-1 ring-zinc-900/5 dark:border-zinc-800 dark:bg-zinc-950 dark:ring-white/5"
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
      ? 'border-zinc-300/90 bg-white/70 dark:border-zinc-600/60 dark:bg-zinc-900/40'
      : emphasis === 'secondary'
        ? 'border-zinc-200 bg-white/70 dark:border-zinc-700/40 dark:bg-zinc-900/40'
        : 'border-zinc-200/80 bg-zinc-50/70 dark:border-zinc-700/30 dark:bg-zinc-900/30'

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
  highlightRole,
  isActiveScan = false,
  isRecentlyTriaged = false,
  isRecentlyChanged = false,
}: {
  task: DemoTask
  highlightRole?: 'source' | 'related'
  isActiveScan?: boolean
  isRecentlyTriaged?: boolean
  isRecentlyChanged?: boolean
}) {
  const isSourceTask = highlightRole === 'source'
  const isRelatedTask = highlightRole === 'related'

  return (
    <div
      className={`rounded-2xl border bg-white p-4 shadow-sm transition duration-300 dark:bg-zinc-950/70 ${
        isSourceTask
          ? 'border-teal-300 ring-1 ring-teal-200 dark:border-teal-500/40 dark:ring-teal-500/20'
          : isRelatedTask
            ? 'border-purple-300 ring-1 ring-purple-200 dark:border-purple-500/40 dark:ring-purple-500/20'
            : 'border-zinc-200 dark:border-zinc-700/40'
      } ${
        isActiveScan
          ? 'scale-[1.02] ring-2 ring-teal-300/80 dark:ring-teal-400/50'
          : ''
      } ${isRecentlyChanged || isRecentlyTriaged ? 'demo-flicker-ring' : ''}`}
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
        {isSourceTask ? <Badge color="softTeal">Source task</Badge> : null}
        {isRelatedTask ? (
          <Badge color="purple">Duplicate match</Badge>
        ) : null}
        <span className="text-[11px] font-medium tracking-wide text-zinc-500 uppercase dark:text-zinc-400">
          {task.ageLabel}
        </span>
      </div>
    </div>
  )
}

function SummaryStep({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-white/60 bg-white/70 p-3 dark:border-white/10 dark:bg-zinc-950/40">
      <p className="text-[11px] font-medium tracking-wide text-zinc-500 uppercase dark:text-zinc-400">
        {label}
      </p>
      <p className="mt-1 text-sm font-medium text-zinc-900 dark:text-zinc-100">
        {value}
      </p>
    </div>
  )
}

function DownFlowIcon(props: React.ComponentPropsWithoutRef<'svg'>) {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" {...props}>
      <path
        d="M10 3.5v10m0 0-4-4m4 4 4-4"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function SummaryArrow() {
  return (
    <div className="flex justify-center py-0.5">
      <DownFlowIcon className="h-4 w-4 text-zinc-500 dark:text-zinc-400" />
    </div>
  )
}

function DetailRow({
  label,
  value,
}: {
  label: string
  value: React.ReactNode
}) {
  return (
    <>
      <dt className="border-t border-zinc-200 pt-3 text-zinc-500 dark:border-zinc-700/40 dark:text-zinc-400">
        {label}
      </dt>
      <dd className="border-t border-zinc-200 pt-3 text-zinc-900 dark:border-zinc-700/40 dark:text-zinc-100">
        {value}
      </dd>
    </>
  )
}
