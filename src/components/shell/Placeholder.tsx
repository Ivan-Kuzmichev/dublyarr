import { Card } from '@/components/ui/Card';
import { PageTitle } from './PageTitle';

export function Placeholder({ title, phase, heading = true }: { title: string; phase: number; heading?: boolean }) {
  return (
    <div className="flex flex-col gap-7">
      {heading ? <PageTitle>{title}</PageTitle> : <h2 className="m-0 text-2xl font-semibold">{title}</h2>}
      <Card className="max-w-xl">
        <p className="m-0 text-[15px] leading-normal text-muted">
          Раздел появится в фазе {phase}. Сейчас готовы вход, первый запуск и настройки безопасности.
        </p>
      </Card>
    </div>
  );
}
