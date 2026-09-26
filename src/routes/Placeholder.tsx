export default function Placeholder({ title, note }: { title: string; note: string }) {
  return (
    <main style={{ maxWidth: 480, margin: '0 auto', padding: 16, background: 'var(--app)', minHeight: '100vh' }}>
      <img src="/assets/wordmark-bare-bones-cut.png" alt="Bare Bones" width={132} height={56} style={{ objectFit: 'contain' }} />
      <h1 style={{ fontFamily: 'var(--font-display)', fontWeight: 400 }}>{title}</h1>
      <p style={{ color: 'var(--text-muted)' }}>{note}</p>
    </main>
  );
}
