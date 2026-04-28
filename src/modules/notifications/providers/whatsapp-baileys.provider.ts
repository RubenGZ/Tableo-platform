import makeWASocket, { useMultiFileAuthState, DisconnectReason } from '@whiskeysockets/baileys'
import type { NotificationChannel, NotificationPayload, NotificationProvider, NotificationResult } from '../types'
import { renderTemplate } from '../types'

let sock: ReturnType<typeof makeWASocket> | null = null

async function getConnection(): Promise<ReturnType<typeof makeWASocket>> {
  if (sock) return sock

  const { state, saveCreds } = await useMultiFileAuthState('./baileys-session')
  sock = makeWASocket({ auth: state, printQRInTerminal: true })

  sock.ev.on('creds.update', saveCreds)
  sock.ev.on('connection.update', ({ connection, lastDisconnect }: { connection?: string; lastDisconnect?: { error?: unknown } }) => {
    if (connection === 'close') {
      const code = (lastDisconnect?.error as any)?.output?.statusCode
      if (code !== DisconnectReason.loggedOut) {
        sock = null  // allow reconnect on next send
      }
    }
  })

  return sock
}

export class WhatsAppBaileysProvider implements NotificationProvider {
  readonly channel: NotificationChannel = 'whatsapp'

  isAvailable(): boolean {
    return sock !== null
  }

  async send(payload: NotificationPayload): Promise<NotificationResult> {
    // WhatsApp is only used for the 1h reminder template
    if (payload.templateKey !== 'booking_reminder_1h') {
      return { success: false, error: 'whatsapp skipped: template not applicable' }
    }

    try {
      const connection = await getConnection()
      const jid = payload.to.replace(/\D/g, '') + '@s.whatsapp.net'
      const text = renderTemplate(payload.templateKey, payload.variables)

      await connection.sendMessage(jid, { text })
      return { success: true }
    } catch (err) {
      return { success: false, error: (err as Error).message }
    }
  }
}
