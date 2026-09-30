import { Logo } from '@/components/ui/Logo';

// Цвета постеров-заглушек — из Login.dc.html; в продукте здесь могли бы быть постеры библиотеки.
const GHOST = [
  '#22394A', '#2B3D2A', '#2A3656', '#3E3322', '#3A2B2A', '#2A3346', '#4A3122', '#4A2A22', '#4A2E40',
  '#233042', '#3A3A36', '#2C3548', '#2F3B2E', '#24454D', '#3B3526', '#4A4222', '#3A2626', '#2E2A26',
];

function AuthAside() {
  return (
    <div className="relative hidden w-[760px] max-w-[53vw] shrink-0 overflow-hidden bg-sidebar lg:block" aria-hidden>
      <div className="absolute -top-[60px] -left-10 grid w-[900px] -rotate-6 grid-cols-6 gap-4 opacity-55">
        {[...GHOST, ...GHOST].map((c, i) => (
          <div key={i} className="aspect-[2/3] rounded-[14px]" style={{ background: c }} />
        ))}
      </div>
      <div className="absolute inset-0 bg-[rgba(18,17,16,0.55)]" />
      <div className="absolute right-16 bottom-16 left-16 flex flex-col gap-4">
        <Logo size="lg" />
        <span className="max-w-[460px] text-lg leading-normal text-text-2">Сериалы в нужной озвучке и качестве — сами, по мере выхода серий.</span>
      </div>
    </div>
  );
}

/** Экраны входа и первого запуска: слева декоративная панель (desktop), справа колонка с формой. */
export function AuthFrame({ children, width = 400 }: { children: React.ReactNode; width?: number }) {
  return (
    <div className="flex min-h-dvh">
      <AuthAside />
      <div className="flex grow justify-center px-6 pt-12 pb-8 lg:items-center lg:py-12">
        <div className="flex w-full flex-col gap-[22px]" style={{ maxWidth: width }}>
          <div className="mb-6 lg:hidden">
            <Logo size="md" />
          </div>
          {children}
        </div>
      </div>
    </div>
  );
}

export function AuthHeading({ title, subtitle }: { title: string; subtitle?: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <h1 className="m-0 font-display text-[26px] font-semibold tracking-[-0.02em] lg:text-[32px]">{title}</h1>
      {subtitle && <span className="text-[15px] leading-normal text-muted">{subtitle}</span>}
    </div>
  );
}

export function FormError({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <p role="alert" className="m-0 text-sm text-danger">
      {message}
    </p>
  );
}
