import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "NEXUS OS — Browser Desktop Environment",
  description:
    "A premium, fully functional browser-based operating system: window manager, virtual filesystem, terminal, code studio, AI agent and more — running entirely in your browser.",
  keywords: ["NEXUS OS", "web desktop", "browser operating system", "window manager", "web IDE"],
  icons: {
    icon: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 72 72'%3E%3Cdefs%3E%3ClinearGradient id='g' x1='0' y1='0' x2='72' y2='72'%3E%3Cstop offset='0' stop-color='%2322d3ee'/%3E%3Cstop offset='1' stop-color='%23a78bfa'/%3E%3C/linearGradient%3E%3C/defs%3E%3Cpath d='M36 4 L62 19 V53 L36 68 L10 53 V19 Z' fill='%2307080b' stroke='url(%23g)' stroke-width='4'/%3E%3Cpath d='M26 48 V24 L46 48 V24' stroke='url(%23g)' stroke-width='6' stroke-linecap='round' stroke-linejoin='round' fill='none'/%3E%3C/svg%3E",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  themeColor: "#050507",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <head>
        <script
          // apply saved theme/accent before first paint (no flash)
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var s=JSON.parse(localStorage.getItem('nexus-settings')||'{}');var st=s&&s.state?s.state:{};var c=document.documentElement;if(st.theme==='light'){c.classList.remove('dark');}if(st.accent){c.style.setProperty('--nx-accent',st.accent);var m=st.accent.replace('#','');if(m.length===3){m=m.split('').map(function(x){return x+x;}).join('');}var n=parseInt(m,16);c.style.setProperty('--nx-accent-rgb',((n>>16)&255)+','+((n>>8)&255)+','+(n&255));}if(st.animations===false){c.classList.add('nx-no-anim');}}catch(e){}})();`,
          }}
        />
      </head>
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
        {children}
      </body>
    </html>
  );
}
