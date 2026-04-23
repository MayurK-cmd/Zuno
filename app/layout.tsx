import type { Metadata } from 'next'
import { Geist, Geist_Mono } from 'next/font/google'
import { Analytics } from '@vercel/analytics/next'
import '@solana/wallet-adapter-react-ui/styles.css'
import './globals.css'
import { Toaster } from '@/components/ui/toaster'
import { WalletContextProvider } from '@/components/zuno/wallet-context-provider'

const geist = Geist({ subsets: ['latin'], variable: '--font-geist-sans' })
const geistMono = Geist_Mono({
  subsets: ['latin'],
  variable: '--font-geist-mono',
})

export const metadata: Metadata = {
  title: 'Zuno',
  description: 'Zero-knowledge UNO on Solana',
  generator: 'Zuno',
  icons: {
    icon: [
      {
        url: '/logo.png',
        type: 'image/png',
      },
    ],
    shortcut: '/logo.png',
    apple: '/logo.png',
  },
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" className="dark">
      <body
        className={`${geist.variable} ${geistMono.variable} bg-background font-sans antialiased`}
      >
        <WalletContextProvider>
          {children}
          <Toaster />
        </WalletContextProvider>
        {process.env.NODE_ENV === 'production' && <Analytics />}
      </body>
    </html>
  )
}
