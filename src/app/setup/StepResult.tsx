import type { StepState } from './actions';

export function StepResult({ state }: { state: StepState }) {
  if (state.error)
    return (
      <p role="alert" className="m-0 text-sm text-danger">
        {state.error}
      </p>
    );
  if (state.ok) return <p className="m-0 text-sm text-progress">{state.ok}</p>;
  return null;
}
