export type TaskStatus = 'backlog' | 'in_progress' | 'done' | 'problematic'
export type SignalKind =
  | 'task_overdue'
  | 'missing_owner'
  | 'duplicate_task'
  | 'stuck_in_progress'
export type ActionType = 'ignored' | 'monitored' | 'escalated' | 'auto-fixed'
export type Severity = 'low' | 'medium' | 'high' | 'critical'
export type TriageDecision = 'ignore' | 'monitor' | 'escalate' | 'auto_fix'
export type TriageSource = 'deterministic' | 'ai' | 'fallback'
export type GuardrailStatus = 'allowed' | 'blocked' | 'not_needed'

export type DemoTask = {
  id: string
  title: string
  owner: string | null
  status: TaskStatus
  priority: 'P0' | 'P1' | 'P2' | 'P3'
  daysInStatus: number
  dueInDays: number | null
  ageLabel: string
}

export type DemoSignal = {
  id: string
  kind: SignalKind
  taskId: string
  relatedTaskIds?: string[]
  title: string
  summary: string
  detectedAt: string
}

export type DemoTriage = {
  signalId: string
  expectationViolated: string
  severity: Severity
  confidence: number
  decision: TriageDecision
  reasoning: string
  source: TriageSource
  aiDecision?: TriageDecision
  suggestedRemediation?: string
  guardrailStatus?: GuardrailStatus
  guardrailReason?: string
}

export type DemoAction = {
  id: string
  signalId: string
  type: ActionType
  message: string
  timestamp: string
  repeatCount: number
}

export type DemoSnapshot = {
  tasks: DemoTask[]
  signals: DemoSignal[]
  triage: Record<string, DemoTriage>
  actions: DemoAction[]
}

export const taskStatusOrder: TaskStatus[] = [
  'backlog',
  'in_progress',
  'done',
  'problematic',
]

export const baseDemoSnapshot: DemoSnapshot = {
  tasks: [
    {
      id: 'task-1',
      title: 'Clean up duplicate customer notes',
      owner: 'Maya',
      status: 'backlog',
      priority: 'P2',
      daysInStatus: 2,
      dueInDays: 3,
      ageLabel: '2d queued',
    },
    {
      id: 'task-2',
      title: 'Fix broken retry message',
      owner: 'Andre',
      status: 'in_progress',
      priority: 'P1',
      daysInStatus: 5,
      dueInDays: 1,
      ageLabel: '5d active',
    },
    {
      id: 'task-3',
      title: 'Publish triage runbook draft',
      owner: 'Priya',
      status: 'done',
      priority: 'P2',
      daysInStatus: 0,
      dueInDays: null,
      ageLabel: 'Done today',
    },
    {
      id: 'task-4',
      title: 'Resolve overdue ops checklist',
      owner: null,
      status: 'problematic',
      priority: 'P0',
      daysInStatus: 9,
      dueInDays: -3,
      ageLabel: '9d stuck',
    },
    {
      id: 'task-5',
      title: 'Close QA follow-up loop',
      owner: 'Noah',
      status: 'in_progress',
      priority: 'P2',
      daysInStatus: 11,
      dueInDays: 2,
      ageLabel: '11d active',
    },
    {
      id: 'task-6',
      title: 'Fix broken retry message',
      owner: 'Lena',
      status: 'backlog',
      priority: 'P3',
      daysInStatus: 1,
      dueInDays: 4,
      ageLabel: '1d queued',
    },
  ],
  signals: [],
  triage: {},
  actions: [],
}

export const weirdDemoSnapshot: DemoSnapshot = {
  tasks: [
    ...baseDemoSnapshot.tasks,
    {
      id: 'task-7',
      title: 'Untangle webhook replay storm',
      owner: null,
      status: 'problematic',
      priority: 'P0',
      daysInStatus: 17,
      dueInDays: -5,
      ageLabel: '17d spiraling',
    },
    {
      id: 'task-8',
      title: 'Publish triage runbook outline',
      owner: 'Eli',
      status: 'backlog',
      priority: 'P3',
      daysInStatus: 13,
      dueInDays: 1,
      ageLabel: '13d queued',
    },
  ],
  signals: [],
  triage: {},
  actions: [],
}

export function cloneSnapshot(snapshot: DemoSnapshot): DemoSnapshot {
  return structuredClone(snapshot)
}

export function getFirstSignalId(snapshot: DemoSnapshot): string {
  return snapshot.signals[0]?.id ?? ''
}

export function findTaskById(snapshot: DemoSnapshot, taskId: string) {
  return snapshot.tasks.find((task) => task.id === taskId) ?? null
}

export function getPriorityRank(priority: DemoTask['priority']) {
  switch (priority) {
    case 'P0':
      return 0
    case 'P1':
      return 1
    case 'P2':
      return 2
    case 'P3':
      return 3
  }
}
