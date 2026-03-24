const colorMap = {
  gray: [
    'bg-gray-50',
    'text-gray-600',
    'inset-ring',
    'inset-ring-gray-500/10',
    'dark:bg-gray-400/10',
    'dark:text-gray-400',
    'dark:inset-ring-gray-400/20',
  ].join(' '),
  red: [
    'bg-red-50',
    'text-red-700',
    'inset-ring',
    'inset-ring-red-600/10',
    'dark:bg-red-400/10',
    'dark:text-red-400',
    'dark:inset-ring-red-400/20',
  ].join(' '),
  yellow: [
    'bg-yellow-50',
    'text-yellow-800',
    'inset-ring',
    'inset-ring-yellow-600/20',
    'dark:bg-yellow-400/10',
    'dark:text-yellow-500',
    'dark:inset-ring-yellow-400/20',
  ].join(' '),
  green: [
    'bg-green-50',
    'text-green-700',
    'inset-ring',
    'inset-ring-green-600/20',
    'dark:bg-green-400/10',
    'dark:text-green-400',
    'dark:inset-ring-green-500/20',
  ].join(' '),
  blue: [
    'bg-blue-50',
    'text-blue-700',
    'inset-ring',
    'inset-ring-blue-700/10',
    'dark:bg-blue-400/10',
    'dark:text-blue-400',
    'dark:inset-ring-blue-400/30',
  ].join(' '),
  indigo: [
    'bg-indigo-50',
    'text-indigo-700',
    'inset-ring',
    'inset-ring-indigo-700/10',
    'dark:bg-indigo-400/10',
    'dark:text-indigo-400',
    'dark:inset-ring-indigo-400/30',
  ].join(' '),
  purple: [
    'bg-purple-50',
    'text-purple-700',
    'inset-ring',
    'inset-ring-purple-700/10',
    'dark:bg-purple-400/10',
    'dark:text-purple-400',
    'dark:inset-ring-purple-400/30',
  ].join(' '),
  pink: [
    'bg-pink-50',
    'text-pink-700',
    'inset-ring',
    'inset-ring-pink-700/10',
    'dark:bg-pink-400/10',
    'dark:text-pink-400',
    'dark:inset-ring-pink-400/20',
  ].join(' '),
  teal: [
    'bg-teal-50',
    'text-teal-700',
    'inset-ring',
    'inset-ring-teal-600/10',
    'dark:bg-teal-400/10',
    'dark:text-teal-400',
    'dark:inset-ring-teal-400/20',
  ].join(' '),
  softTeal: [
    'bg-teal-50/40',
    'text-teal-600',
    'inset-ring',
    'inset-ring-teal-600/10',
    'dark:bg-teal-900/20',
    'dark:text-teal-300',
  ].join(' '),
} as const

type BadgeColor = keyof typeof colorMap

export default function Badge({
  color = 'gray',
  customStyles,
  children,
}: {
  color?: BadgeColor
  customStyles?: string
  children: React.ReactNode
}) {
  const baseStyles = 'inline-flex items-center rounded-full px-2 text-xs'
  return (
    <span
      className={` ${customStyles ? customStyles : baseStyles} ${colorMap[color]}`}
    >
      {children}
    </span>
  )
}
