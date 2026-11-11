import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../lib/api'
import { dateTime } from '../lib/format'

const QUICK_REPLIES = {
  rider: ["I'm at the pickup", 'Coming in 2 mins', 'Please call when you arrive', 'Where are you?'],
  driver: ["I've arrived", 'On my way', 'Stuck in traffic, 5 mins', 'Please come to the main gate'],
}

/**
 * Rider-driver chat for a ride. New messages arrive through live updates: the parent bumps
 * `refreshKey`, and only messages after the last one shown are fetched.
 */
export default function Chat({ rideId, role, otherName, canSend, refreshKey, onClose, onUnread }) {
  const [messages, setMessages] = useState([])
  const [text, setText] = useState('')
  const [error, setError] = useState(null)
  const [sending, setSending] = useState(false)
  const lastId = useRef(0)
  const listRef = useRef(null)

  const load = useCallback(async () => {
    try {
      const data = await api(`/rides/${rideId}/messages?after=${lastId.current}`)
      if (data.messages.length) {
        lastId.current = data.messages[data.messages.length - 1].id
        setMessages((current) => [...current, ...data.messages.filter((m) => !current.some((c) => c.id === m.id))])
        if (data.messages.some((m) => !m.mine)) onUnread?.()
      }
    } catch (err) {
      setError(err.message)
    }
  }, [rideId, onUnread])

  useEffect(() => {
    load()
  }, [load, refreshKey])

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight })
  }, [messages])

  async function send(body) {
    const value = body.trim()
    if (!value || sending) return
    setSending(true)
    setError(null)
    try {
      const { message } = await api(`/rides/${rideId}/messages`, { method: 'POST', body: { text: value } })
      lastId.current = Math.max(lastId.current, message.id)
      setMessages((current) => [...current, message])
      setText('')
    } catch (err) {
      setError(err.message)
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="absolute inset-0 z-40 flex flex-col bg-white" role="dialog" aria-label={`Chat with ${otherName}`}>
      <div className="flex items-center gap-2 border-b border-neutral-100 p-4">
        <button onClick={onClose} aria-label="Close chat" className="flex h-10 w-10 items-center justify-center rounded-full text-xl hover:bg-neutral-100">
          <i className="ri-arrow-left-line" />
        </button>
        <div>
          <p className="font-semibold">{otherName}</p>
          <p className="text-xs text-neutral-500">Messages stay in the app; your number is never shared.</p>
        </div>
      </div>
      <div ref={listRef} className="flex flex-1 flex-col gap-2 overflow-y-auto bg-neutral-50 p-4">
        {!messages.length && <p className="m-auto text-sm text-neutral-500">No messages yet. Say hello!</p>}
        {messages.map((message) => (
          <div key={message.id} className={`max-w-[80%] rounded-2xl px-3 py-2 ${message.mine ? 'self-end rounded-br-sm bg-black text-white' : 'self-start rounded-bl-sm bg-white shadow-sm'}`}>
            <p className="whitespace-pre-wrap break-words">{message.body}</p>
            <p className={`mt-0.5 text-[10px] ${message.mine ? 'text-neutral-300' : 'text-neutral-400'}`}>{dateTime(message.sentAt)}</p>
          </div>
        ))}
      </div>
      {error && <p className="bg-red-50 px-4 py-2 text-sm text-red-700">{error}</p>}
      {canSend ? (
        <div className="border-t border-neutral-100 p-3">
          <div className="mb-2 flex gap-2 overflow-x-auto pb-1">
            {QUICK_REPLIES[role].map((reply) => (
              <button key={reply} className="chip shrink-0" onClick={() => send(reply)} disabled={sending}>
                {reply}
              </button>
            ))}
          </div>
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              send(text)
            }}
          >
            <input className="input" placeholder="Message" maxLength={500} value={text} onChange={(e) => setText(e.target.value)} aria-label="Message" />
            <button className="btn-primary px-4" disabled={sending || !text.trim()} aria-label="Send">
              <i className="ri-send-plane-2-fill" />
            </button>
          </form>
        </div>
      ) : (
        <p className="border-t border-neutral-100 p-4 text-center text-sm text-neutral-500">This ride has ended; the chat is read-only.</p>
      )}
    </div>
  )
}

/** Notices new messages from the other person while the chat is closed (shows a red dot on Chat). */
export function UnreadWatcher({ rideId, refreshKey, onUnread }) {
  const seen = useRef(null)
  const callback = useRef(onUnread)
  callback.current = onUnread
  useEffect(() => {
    api(`/rides/${rideId}/messages?after=${seen.current ?? 0}`)
      .then(({ messages }) => {
        const first = seen.current === null
        if (messages.length) seen.current = messages[messages.length - 1].id
        else if (first) seen.current = 0
        if (!first && messages.some((m) => !m.mine)) callback.current()
      })
      .catch(() => {})
  }, [rideId, refreshKey])
  return null
}
