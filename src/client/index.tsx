/**
 * Browser half of `@deepseek-ai/dsh-plugin-kmanager` (`dsh.client` dual face).
 * Loaded by the web boot graph through the host's client-modules scan, then
 * activated as a cordis fiber with `slots` injected. Registers one
 * `sidebar.footer.action` list entry so the button renders above the Settings
 * row inside the sidebar foot (the shell declares that hole already).
 *
 * The bundle externalizes the standard kit (react, slots service) and inlines
 * nothing shared: this half owns only its button + modal chrome.
 */

import { useEffect, useState } from 'react'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'

/** entry id for the footer action list slot (distinct from the page route). */
const ACTION_ID = 'plugin-kmanager'
const PAGE_PATH = '/kmanager'

/** Services required by the plugin's client half. */
export const inject = ['slots']

/**
 * Footer action: opens the manager in a floating modal (reuses the standalone
 * /kmanager page via an iframe, so the browser half owns no grid code).
 * @param props - owner share from the sidebar shell (column width state).
 */
export function KManagerAction({ wide }: { wide: boolean }) {
  const [open, setOpen] = useState(false)
  // Close on Escape or a close request from inside the iframe page.
  useEffect(() => {
    if (!open) return undefined
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    const onMessage = (event: MessageEvent) => {
      if (event.data?.type === 'kmanager-close') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('message', onMessage)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('message', onMessage)
    }
  }, [open])

  return <>
    <button
      type="button"
      title="插件管理"
      aria-label="插件管理"
      onClick={() => setOpen(true)}
      style={{
        flex: 'none',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: wide ? 'flex-start' : 'center',
        gap: 8,
        width: wide ? 'calc(100% + 8px)' : 36,
        height: wide ? 34 : 36,
        margin: wide ? '4px -4px 4px' : '8px 0 10px',
        padding: wide ? '6px 2px 6px 10px' : 0,
        boxSizing: 'border-box',
        border: 'none',
        borderRadius: wide ? 12 : '50%',
        background: 'transparent',
        color: 'inherit',
        cursor: 'pointer',
        fontFamily: 'inherit',
        fontSize: 14,
        lineHeight: 1,
        whiteSpace: 'nowrap',
      }}
      onMouseEnter={(event) => { event.currentTarget.style.backgroundColor = 'var(--dsw-alias-interactive-bg-hover, rgba(127,127,127,.12))' }}
      onMouseLeave={(event) => { event.currentTarget.style.backgroundColor = 'transparent' }}
    >
      <span aria-hidden style={{ display: 'inline-block', width: wide ? 16 : 18, height: wide ? 16 : 18 }}>
        <svg viewBox="0 0 12 12" width={wide ? 16 : 18} height={wide ? 16 : 18}>
          <rect x="0.5" y="0.5" width="5" height="5" rx="1" fill="currentColor" />
          <rect x="6.5" y="0.5" width="5" height="5" rx="1" fill="currentColor" opacity=".55" />
          <rect x="0.5" y="6.5" width="5" height="5" rx="1" fill="currentColor" opacity=".55" />
          <rect x="6.5" y="6.5" width="5" height="5" rx="1" fill="currentColor" />
        </svg>
      </span>
      {wide && <span>插件管理</span>}
    </button>
    {open && (
      <div
        role="dialog"
        aria-modal="true"
        aria-label="插件管理"
        onClick={() => setOpen(false)}
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 9999,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'rgba(0,0,0,.55)',
          padding: 32,
        }}
      >
        <div
          onClick={(event) => { event.stopPropagation() }}
          style={{
            display: 'flex',
            flexDirection: 'column',
            width: 'min(1080px, 92vw)',
            height: 'min(780px, 86vh)',
            borderRadius: 12,
            overflow: 'hidden',
            background: 'var(--dsw-surface, #17181c)',
            color: 'var(--dsw-text, #ececf1)',
            boxShadow: '0 12px 40px rgba(0,0,0,.45)',
          }}
        >
          <iframe
            src={PAGE_PATH}
            title="插件管理"
            style={{ flex: 1, width: '100%', border: 'none', background: '#0f1012' }}
          />
        </div>
      </div>
    )}
  </>
}

/**
 * Register the footer action once ui-sidebar declares the hole. Activation
 * order is unconstrained, so the slot is waited on through inject().
 * @param ctx - client root context with the injected slots service.
 */
export function apply(ctx: ClientContext): void {
  ctx.slots.inject('sidebar.footer.action', () =>
    ctx.slots.register({ name: 'sidebar.footer.action', id: ACTION_ID, order: 0 }, KManagerAction))
}