import {
  getPriorityRank,
  type DemoAction,
  type DemoSignal,
  type DemoSnapshot,
  type DemoTask,
  type DemoTriage,
  type GuardrailStatus,
  type Severity,
  type SignalKind,
  type TriageDecision,
} from '@/components/demo/demoData'

type DerivedState = Pick<DemoSnapshot, 'signals' | 'triage' | 'actions'>
export type TaskPassDecision = {
  nextTask: DemoTask
  changed: boolean
  title: string
  reasoning: string
  tone: 'stable' | 'monitor' | 'escalate'
}
type AiTriageResult = {
  signalId: string
  severity: Severity
  decision: TriageDecision
  confidence: number
  reasoning: string
  suggestedRemediation: string
}

function promoteSeverity(severity: Severity): Severity {
  switch (severity) {
    case 'low':
      return 'medium'
    case 'medium':
      return 'high'
    case 'high':
      return 'critical'
    case 'critical':
      return 'critical'
  }
}

const timestampLabels = [
  'Just now',
  '1 min ago',
  '2 min ago',
  '4 min ago',
  '7 min ago',
  '11 min ago',
]

const signalPriority: Record<SignalKind, number> = {
  missing_owner: 0,
  task_overdue: 1,
  stuck_in_progress: 2,
  duplicate_task: 3,
}

function stableTimestamp(index: number) {
  return timestampLabels[index] ?? `${index + 1} min ago`
}

function normalizeTitle(title: string) {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function formatTaskReference(task: DemoTask) {
  return task.title.toLowerCase()
}

function severityForOverdue(task: DemoTask): Severity {
  const rank = getPriorityRank(task.priority)

  if (rank <= 1 || task.status === 'problematic') {
    return 'high'
  }

  return rank === 2 ? 'medium' : 'low'
}

function decisionForOverdue(task: DemoTask): TriageDecision {
  return getPriorityRank(task.priority) <= 1 || task.status === 'problematic'
    ? 'escalate'
    : 'monitor'
}

function decisionForMissingOwner(task: DemoTask): TriageDecision {
  return getPriorityRank(task.priority) <= 1 ? 'auto_fix' : 'monitor'
}

function decisionForDuplicate(task: DemoTask): TriageDecision {
  return getPriorityRank(task.priority) <= 1 ? 'monitor' : 'ignore'
}

function severityForDuplicate(task: DemoTask): Severity {
  return getPriorityRank(task.priority) <= 1 ? 'medium' : 'low'
}

function sortSignals(signals: DemoSignal[]) {
  return [...signals].sort((left, right) => {
    const leftPriority = signalPriority[left.kind]
    const rightPriority = signalPriority[right.kind]

    if (leftPriority !== rightPriority) {
      return leftPriority - rightPriority
    }

    return left.title.localeCompare(right.title)
  })
}

function suggestedRemediationForDecision(
  decision: TriageDecision,
  task: DemoTask,
  signal: DemoSignal,
) {
  switch (decision) {
    case 'ignore':
      return `Record ${signal.kind} for ${task.title} and continue delivery unless the signal repeats.`
    case 'monitor':
      return `Keep ${task.title} on a watch list and review the owner or progress during the next triage pass.`
    case 'escalate':
      return `Route ${task.title} to manual review and move coordination into the problematic lane until ownership is clear.`
    case 'auto_fix':
      return `Apply the deterministic fallback correction for ${task.title} without changing any other task fields.`
  }
}

function resolveGuardrail(
  signal: DemoSignal,
  task: DemoTask,
  aiDecision: TriageDecision,
  fallbackDecision: TriageDecision,
): {
  appliedDecision: TriageDecision
  status: GuardrailStatus
  reason: string
} {
  if (aiDecision !== 'auto_fix') {
    return {
      appliedDecision: aiDecision,
      status: 'not_needed',
      reason: 'No automated remediation was requested, so the guardrail layer did not need to intervene.',
    }
  }

  const autoFixAllowed =
    signal.kind === 'missing_owner' &&
    task.owner === null &&
    task.status !== 'done' &&
    getPriorityRank(task.priority) <= 1

  if (autoFixAllowed) {
    return {
      appliedDecision: aiDecision,
      status: 'allowed',
      reason:
        'Deterministic fallback routing is allowed only for ownerless active work at P0 or P1 priority.',
    }
  }

  return {
    appliedDecision: fallbackDecision,
    status: 'blocked',
    reason:
      'Auto-fix was blocked because this signal does not meet the deterministic safety rule for automated correction.',
  }
}

function clampConfidence(confidence: number) {
  if (!Number.isFinite(confidence)) {
    return 0.5
  }

  return Math.min(1, Math.max(0, confidence))
}

export function evaluateTaskPassDecision(task: DemoTask): TaskPassDecision {
  if (task.status === 'done') {
    return {
      nextTask: task,
      changed: false,
      title: 'No change',
      reasoning: 'Completed work is skipped during the active triage scan.',
      tone: 'stable',
    }
  }

  if (task.owner === null && getPriorityRank(task.priority) <= 1) {
    const nextTask =
      task.status === 'problematic'
        ? task
        : {
            ...task,
            status: 'problematic',
            ageLabel: 'Escalated just now',
          }

    return {
      nextTask,
      changed: nextTask !== task,
      title: task.status === 'problematic' ? 'Escalation confirmed' : 'Escalated',
      reasoning: `${task.priority} work without an owner is treated as unsafe and routed into problematic handling.`,
      tone: 'escalate',
    }
  }

  if (
    task.dueInDays !== null &&
    task.dueInDays < 0 &&
    task.daysInStatus >= 7 &&
    getPriorityRank(task.priority) === 0
  ) {
    const nextTask =
      task.status === 'problematic'
        ? task
        : {
            ...task,
            status: 'problematic',
            ageLabel: 'Escalated just now',
          }

    return {
      nextTask,
      changed: nextTask !== task,
      title: task.status === 'problematic' ? 'Escalation confirmed' : 'Escalated',
      reasoning: `Priority ${task.priority} + ${task.daysInStatus} days stagnant beyond due window triggered problematic-state handling.`,
      tone: 'escalate',
    }
  }

  if (task.status === 'in_progress' && task.daysInStatus >= 10) {
    if (getPriorityRank(task.priority) <= 1) {
      const nextTask =
        task.status === 'problematic'
          ? task
          : {
              ...task,
              status: 'problematic',
              ageLabel: 'Escalated just now',
            }

      return {
        nextTask,
        changed: nextTask !== task,
        title:
          task.status === 'problematic' ? 'Escalation confirmed' : 'Escalated',
        reasoning: `${task.daysInStatus} days in progress at ${task.priority} priority reads as coordination failure, so the task was escalated.`,
        tone: 'escalate',
      }
    }

    return {
      nextTask: task,
      changed: false,
      title: 'Monitored',
      reasoning: `${task.daysInStatus} days in progress triggered watch-list monitoring, but the current priority did not justify an automatic state change.`,
      tone: 'monitor',
    }
  }

  return {
    nextTask: task,
    changed: false,
    title: 'Stable',
    reasoning: 'No deterministic escalation rule fired for this task in the current scan.',
    tone: 'stable',
  }
}

export function buildTriageContextKey(
  signal: DemoSignal,
  tasks: DemoTask[],
  triage: DemoTriage,
) {
  const task = tasks.find((item) => item.id === signal.taskId)
  const relatedTasks = (signal.relatedTaskIds ?? [])
    .map((taskId) => tasks.find((item) => item.id === taskId))
    .filter((item): item is DemoTask => item !== undefined)
    .map((item) => ({
      id: item.id,
      title: item.title,
      owner: item.owner,
      status: item.status,
      priority: item.priority,
      daysInStatus: item.daysInStatus,
      dueInDays: item.dueInDays,
    }))
    .sort((left, right) => left.id.localeCompare(right.id))

  return JSON.stringify({
    signalId: signal.id,
    signalKind: signal.kind,
    taskId: signal.taskId,
    expectationViolated: triage.expectationViolated,
    task: task
      ? {
          id: task.id,
          title: task.title,
          owner: task.owner,
          status: task.status,
          priority: task.priority,
          daysInStatus: task.daysInStatus,
          dueInDays: task.dueInDays,
        }
      : null,
    relatedTasks,
  })
}

export function detectSignals(tasks: DemoTask[]): DemoSignal[] {
  const signals: DemoSignal[] = []

  for (const task of tasks) {
    if (task.status !== 'done' && !task.owner) {
      signals.push({
        id: `missing_owner-${task.id}`,
        kind: 'missing_owner',
        taskId: task.id,
        title: 'Critical task has no assigned owner',
        summary: `${task.title} is active without a directly responsible owner.`,
        detectedAt: '',
      })
    }

    if (task.status !== 'done' && task.dueInDays !== null && task.dueInDays < 0) {
      signals.push({
        id: `task_overdue-${task.id}`,
        kind: 'task_overdue',
        taskId: task.id,
        title: 'Task breached expected due window',
        summary: `${task.title} is overdue and still not complete.`,
        detectedAt: '',
      })
    }

    if (task.status === 'in_progress' && task.daysInStatus >= 7) {
      signals.push({
        id: `stuck_in_progress-${task.id}`,
        kind: 'stuck_in_progress',
        taskId: task.id,
        title: 'Work item appears stuck in progress',
        summary: `${task.title} has stayed in progress longer than expected.`,
        detectedAt: '',
      })
    }
  }

  const activeTasks = tasks.filter((task) => task.status !== 'done')
  const titleGroups = new Map<string, DemoTask[]>()

  for (const task of activeTasks) {
    const normalizedTitle = normalizeTitle(task.title)
    const group = titleGroups.get(normalizedTitle) ?? []
    group.push(task)
    titleGroups.set(normalizedTitle, group)
  }

  for (const [normalizedTitle, matchingTasks] of titleGroups.entries()) {
    if (normalizedTitle.length === 0 || matchingTasks.length < 2) {
      continue
    }

    const sortedTasks = [...matchingTasks].sort(
      (left, right) =>
        getPriorityRank(left.priority) - getPriorityRank(right.priority) ||
        left.id.localeCompare(right.id),
    )
    const primary = sortedTasks[0]
    const secondary = sortedTasks[1]
    const relatedTaskIds = sortedTasks.slice(1).map((task) => task.id)

    signals.push({
      id: `duplicate_task-${sortedTasks.map((task) => task.id).join(':')}`,
      kind: 'duplicate_task',
      taskId: primary.id,
      relatedTaskIds,
      title: 'Duplicate task title detected',
      summary: `${primary.title} appears more than once in active work and should be consolidated.`,
      detectedAt: '',
    })
  }

  return sortSignals(signals).map((signal, index) => ({
    ...signal,
    detectedAt: stableTimestamp(index),
  }))
}

export function deriveTriage(
  signals: DemoSignal[],
  tasks: DemoTask[],
): Record<string, DemoTriage> {
  const taskMap = new Map(tasks.map((task) => [task.id, task]))

  return Object.fromEntries(
    signals.map((signal) => {
      const task = taskMap.get(signal.taskId)

      if (!task) {
        return [
          signal.id,
          {
            signalId: signal.id,
            expectationViolated: 'Task state should remain internally consistent.',
            severity: 'low' as const,
            confidence: 0.5,
            decision: 'ignore' as const,
            reasoning: 'The referenced task could not be resolved in the current snapshot.',
            source: 'deterministic' as const,
            aiDecision: 'ignore' as const,
            suggestedRemediation:
              'Review the signal manually because the source task could not be resolved.',
            guardrailStatus: 'not_needed' as const,
            guardrailReason:
              'No automated remediation was requested for this unresolved task reference.',
          },
        ]
      }

      switch (signal.kind) {
        case 'missing_owner':
          return [
            signal.id,
            {
              signalId: signal.id,
              expectationViolated: 'Active tasks should have a clear owner.',
              severity: getPriorityRank(task.priority) <= 1 ? 'critical' : 'medium',
              confidence: 0.98,
              decision: decisionForMissingOwner(task),
              reasoning:
                getPriorityRank(task.priority) <= 1
                  ? 'High-priority work without an owner can use a deterministic fallback routing path.'
                  : 'The task needs attention, but a monitor-first response is sufficient for this priority.',
              source: 'deterministic',
              aiDecision: decisionForMissingOwner(task),
              suggestedRemediation: suggestedRemediationForDecision(
                decisionForMissingOwner(task),
                task,
                signal,
              ),
              guardrailStatus:
                decisionForMissingOwner(task) === 'auto_fix'
                  ? 'allowed'
                  : 'not_needed',
              guardrailReason:
                decisionForMissingOwner(task) === 'auto_fix'
                  ? 'The deterministic fallback owner rule allows an automated correction for this high-priority ownerless task.'
                  : 'No automated remediation was requested for this deterministic baseline.',
            },
          ]
        case 'task_overdue':
          return [
            signal.id,
            {
              signalId: signal.id,
              expectationViolated: 'Non-done tasks should not remain past their due window.',
              severity: severityForOverdue(task),
              confidence: 0.94,
              decision: decisionForOverdue(task),
              reasoning:
                decisionForOverdue(task) === 'escalate'
                  ? 'The overdue work is either high priority or already problematic, so it should be raised immediately.'
                  : 'The task is overdue, but a watch-list response is enough for the current risk level.',
              source: 'deterministic',
              aiDecision: decisionForOverdue(task),
              suggestedRemediation: suggestedRemediationForDecision(
                decisionForOverdue(task),
                task,
                signal,
              ),
              guardrailStatus: 'not_needed',
              guardrailReason:
                'No automated remediation was requested for this deterministic baseline.',
            },
          ]
        case 'stuck_in_progress': {
          const stuckDecision =
            task.daysInStatus >= 12 && getPriorityRank(task.priority) <= 1
              ? 'escalate'
              : 'monitor'

          return [
            signal.id,
            {
              signalId: signal.id,
              expectationViolated: 'In-progress work should show movement within a reasonable time window.',
              severity:
                task.daysInStatus >= 10 || getPriorityRank(task.priority) <= 1
                  ? 'high'
                  : 'medium',
              confidence: 0.86,
              decision: stuckDecision,
              reasoning:
                stuckDecision === 'escalate'
                  ? 'The task has been active too long for its priority, so it should be escalated.'
                  : 'The task looks stale and should be monitored before stronger intervention.',
              source: 'deterministic',
              aiDecision: stuckDecision,
              suggestedRemediation: suggestedRemediationForDecision(
                stuckDecision,
                task,
                signal,
              ),
              guardrailStatus: 'not_needed',
              guardrailReason:
                'No automated remediation was requested for this deterministic baseline.',
            },
          ]
        }
        case 'duplicate_task': {
          const duplicateDecision = decisionForDuplicate(task)

          return [
            signal.id,
            {
              signalId: signal.id,
              expectationViolated: 'Duplicate work should be consolidated before more effort is spent.',
              severity: severityForDuplicate(task),
              confidence: 0.74,
              decision: duplicateDecision,
              reasoning:
                duplicateDecision === 'monitor'
                  ? 'The overlap is meaningful enough to watch before more work continues.'
                  : 'The overlap is low-risk, so the system can record it without interrupting delivery.',
              source: 'deterministic',
              aiDecision: duplicateDecision,
              suggestedRemediation: suggestedRemediationForDecision(
                duplicateDecision,
                task,
                signal,
              ),
              guardrailStatus: 'not_needed',
              guardrailReason:
                'No automated remediation was requested for this deterministic baseline.',
            },
          ]
        }
      }
    }),
  )
}

export function applyAiTriageResult(
  signal: DemoSignal,
  tasks: DemoTask[],
  baseline: DemoTriage,
  aiResult: AiTriageResult,
): DemoTriage {
  const task = tasks.find((item) => item.id === signal.taskId)

  if (!task) {
    return markTriageFallback(
      baseline,
      'The AI result could not be applied because the source task was no longer available.',
    )
  }

  const guardrail = resolveGuardrail(
    signal,
    task,
    aiResult.decision,
    baseline.decision,
  )

  return {
    ...baseline,
    severity: aiResult.severity,
    confidence: clampConfidence(aiResult.confidence),
    decision: guardrail.appliedDecision,
    reasoning: aiResult.reasoning,
    source: 'ai',
    aiDecision: aiResult.decision,
    suggestedRemediation: aiResult.suggestedRemediation,
    guardrailStatus: guardrail.status,
    guardrailReason: guardrail.reason,
  }
}

export function simulatePseudoAiTriage(
  signal: DemoSignal,
  tasks: DemoTask[],
  baseline: DemoTriage,
): DemoTriage {
  const task = tasks.find((item) => item.id === signal.taskId)

  if (!task) {
    return markTriageFallback(
      baseline,
      'Pseudo AI could not resolve the source task, so the deterministic baseline was used.',
    )
  }

  let pseudoResult: AiTriageResult

  switch (signal.kind) {
    case 'missing_owner':
      pseudoResult = {
        signalId: signal.id,
        severity:
          getPriorityRank(task.priority) <= 1 ? 'critical' : 'high',
        decision: 'auto_fix',
        confidence: 0.81,
        reasoning:
          getPriorityRank(task.priority) <= 1
            ? 'Ownerless work is blocking execution, so a fallback routing correction is worth attempting.'
            : 'Pseudo AI prefers a routing correction first, but the guardrail layer may still require review.',
        suggestedRemediation: `Assign a fallback owner for ${task.title} and notify the team lead.`,
      }
      break
    case 'task_overdue':
      pseudoResult = {
        signalId: signal.id,
        severity: promoteSeverity(baseline.severity),
        decision: 'escalate',
        confidence: 0.78,
        reasoning:
          task.status === 'problematic'
            ? 'The overdue state is already compounding, so this should be treated as an escalation.'
            : 'Pseudo AI treats overdue work as more urgent when it risks blocking follow-on tasks.',
        suggestedRemediation: `Escalate ${task.title} to an owner review and re-plan the due window.`,
      }
      break
    case 'stuck_in_progress':
      pseudoResult = {
        signalId: signal.id,
        severity:
          task.daysInStatus >= 10 ? 'high' : baseline.severity,
        decision: task.daysInStatus >= 10 ? 'escalate' : 'monitor',
        confidence: 0.76,
        reasoning:
          task.daysInStatus >= 10
            ? 'Pseudo AI reads prolonged in-progress work as a coordination failure, not just drift.'
            : 'The task may still recover, but it should stay visible until movement resumes.',
        suggestedRemediation: `Request a blocker update on ${task.title} and escalate if no movement appears in the next pass.`,
      }
      break
    case 'duplicate_task':
      pseudoResult = {
        signalId: signal.id,
        severity: 'medium',
        decision: 'monitor',
        confidence: 0.69,
        reasoning:
          'Pseudo AI treats duplicate active work as coordination debt that should be watched before more time is spent.',
        suggestedRemediation: `Compare ownership across the duplicate tasks and consolidate the surviving work item.`,
      }
      break
  }

  return applyAiTriageResult(signal, tasks, baseline, pseudoResult)
}

export function markTriageFallback(
  triage: DemoTriage,
  reason = 'AI triage was unavailable, so the deterministic baseline was used.',
): DemoTriage {
  return {
    ...triage,
    source: 'fallback',
    aiDecision: triage.aiDecision ?? triage.decision,
    guardrailStatus: triage.guardrailStatus ?? 'not_needed',
    guardrailReason: reason,
  }
}

export function deriveActionForSignal(
  signal: DemoSignal,
  triage: DemoTriage,
  tasks: DemoTask[],
  actionId: string,
  timestamp: string,
): DemoAction {
  const task = tasks.find((item) => item.id === signal.taskId)
  const taskLabel = task ? formatTaskReference(task) : 'the selected task'

  switch (triage.decision) {
    case 'ignore':
      return {
        id: actionId,
        signalId: signal.id,
        type: 'ignored',
        message: `No action taken for ${taskLabel}; the signal was logged for visibility only.`,
        timestamp,
        repeatCount: 1,
      }
    case 'monitor':
      return {
        id: actionId,
        signalId: signal.id,
        type: 'monitored',
        message: `Added ${taskLabel} to the watch list for follow-up review.`,
        timestamp,
        repeatCount: 1,
      }
    case 'escalate':
      return {
        id: actionId,
        signalId: signal.id,
        type: 'escalated',
        message: `Raised ${taskLabel} for manual review and problematic-state handling.`,
        timestamp,
        repeatCount: 1,
      }
    case 'auto_fix':
      return {
        id: actionId,
        signalId: signal.id,
        type: 'auto-fixed',
        message: `Applied fallback correction for ${taskLabel} using a deterministic routing rule.`,
        timestamp,
        repeatCount: 1,
      }
  }
}

export function deriveActions(
  signals: DemoSignal[],
  triage: Record<string, DemoTriage>,
  tasks: DemoTask[],
  passLabel: string,
): DemoAction[] {
  return signals.map((signal, index) =>
    deriveActionForSignal(
      signal,
      triage[signal.id],
      tasks,
      `action-${passLabel}-${signal.id}`,
      stableTimestamp(index),
    ),
  )
}

export function mergeActionEntries(
  existingActions: DemoAction[],
  nextActions: DemoAction[],
): DemoAction[] {
  const merged = [...existingActions]

  for (const nextAction of nextActions) {
    const existingIndex = merged.findIndex(
      (action) =>
        action.signalId === nextAction.signalId && action.type === nextAction.type,
    )

    if (existingIndex === -1) {
      merged.unshift(nextAction)
      continue
    }

    const existingAction = merged[existingIndex]
    const updatedAction: DemoAction = {
      ...existingAction,
      id: nextAction.id,
      timestamp: nextAction.timestamp,
      repeatCount: existingAction.repeatCount + 1,
    }

    merged.splice(existingIndex, 1)
    merged.unshift(updatedAction)
  }

  return merged
}

export function evaluateTasks(
  tasks: DemoTask[],
  passLabel: string,
): DerivedState {
  const signals = detectSignals(tasks)
  const triage = deriveTriage(signals, tasks)
  const actions = deriveActions(signals, triage, tasks, passLabel)

  return {
    signals,
    triage,
    actions,
  }
}
