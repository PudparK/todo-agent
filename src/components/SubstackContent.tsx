'use client'

import React, { Fragment, useEffect, useRef, useState } from 'react'
import {
  Dialog,
  DialogPanel,
  Transition,
  TransitionChild,
} from '@headlessui/react'

type Props = {
  html: string
}

export function SubstackContent({ html }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null)
  const [lightboxAlt, setLightboxAlt] = useState('')
  const isOpen = lightboxSrc !== null

  // Delegate clicks to any Substack image/link
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const handleClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null
      if (!target) return

      const link = target.closest<HTMLAnchorElement>(
        'a.image-link, a[href*="substackcdn.com"]',
      )
      const img = target.closest<HTMLImageElement>('img')

      if (!link && !img) return

      event.preventDefault()

      const srcFromLink = link?.getAttribute('href')
      const srcFromImg = img?.getAttribute('src')
      const src = srcFromLink || srcFromImg
      if (!src) return

      setLightboxSrc(src)
      setLightboxAlt(img?.alt ?? '')
    }

    container.addEventListener('click', handleClick)
    return () => container.removeEventListener('click', handleClick)
  }, [])

  const close = () => {
    setLightboxSrc(null)
    setLightboxAlt('')
  }

  return (
    <>
      <div
        ref={containerRef}
        className="prose-zinc substack-body prose max-w-none dark:prose-invert"
        dangerouslySetInnerHTML={{ __html: html }}
      />

      <Transition appear show={isOpen} as={Fragment}>
        <Dialog as="div" className="relative z-50" onClose={close}>
          {/* Backdrop */}
          <TransitionChild
            as={Fragment}
            enter="ease-out duration-150"
            enterFrom="opacity-0"
            enterTo="opacity-100"
            leave="ease-in duration-100"
            leaveFrom="opacity-100"
            leaveTo="opacity-0"
          >
            <div className="fixed inset-0 bg-black/80" />
          </TransitionChild>

          <div className="fixed inset-0 overflow-y-auto">
            <div className="flex min-h-full items-center justify-center p-4">
              <TransitionChild
                as={Fragment}
                enter="ease-out duration-150"
                enterFrom="opacity-0 scale-95"
                enterTo="opacity-100 scale-100"
                leave="ease-in duration-100"
                leaveFrom="opacity-100 scale-100"
                leaveTo="opacity-0 scale-95"
              >
                <DialogPanel className="relative">
                  <button type="button" onClick={close} className="sr-only">
                    Close image
                  </button>

                  {lightboxSrc && (
                    <img
                      src={lightboxSrc}
                      alt={lightboxAlt || 'Substack image'}
                      className="max-h-[90vh] max-w-[90vw] rounded-xl shadow-2xl"
                    />
                  )}
                </DialogPanel>
              </TransitionChild>
            </div>
          </div>
        </Dialog>
      </Transition>
    </>
  )
}
