const colorMap = {
  gray: [
    'bg-gray-50',
    'text-gray-600',
    'dark:bg-gray-400/10',
    'dark:text-gray-400',
  ].join(' '),
  red: [
    'bg-red-50',
    'text-red-700',
    'dark:bg-red-400/10',
    'dark:text-red-400',
  ].join(' '),
  yellow: [
    'bg-yellow-50',
    'text-yellow-800',
    'dark:bg-yellow-400/10',
    'dark:text-yellow-500',
  ].join(' '),
  green: [
    'bg-green-50',
    'text-green-700',
    'dark:bg-green-400/10',
    'dark:text-green-400',
  ].join(' '),
  blue: [
    'bg-blue-50',
    'text-blue-700',
    'dark:bg-blue-400/10',
    'dark:text-blue-400',
  ].join(' '),
  indigo: [
    'bg-indigo-50',
    'text-indigo-700',
    'dark:bg-indigo-400/10',
    'dark:text-indigo-400',
  ].join(' '),
  purple: [
    'bg-purple-50',
    'text-purple-700',
    'dark:bg-purple-400/10',
    'dark:text-purple-400',
  ].join(' '),
  pink: [
    'bg-pink-50',
    'text-pink-700',
    'dark:bg-pink-400/10',
    'dark:text-pink-400',
  ].join(' '),
  teal: [
    'bg-teal-50',
    'text-teal-700',
    'dark:bg-teal-400/10',
    'dark:text-teal-400',
  ].join(' '),
  softTeal: [
    'bg-teal-50/40',
    'text-teal-600',
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
