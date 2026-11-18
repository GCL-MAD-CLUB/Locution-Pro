import { Component, createElement, type ReactNode } from "react";

import { normalizeError } from "../../errors/runtime";

type Release = () => void;
type Acquire = () => void | Release;
type Phase = "beforePaint" | "afterCommit";
interface Resource {
  phase: Phase;
  acquire: Acquire;
  keys?: readonly unknown[];
}
interface ActiveResource extends Resource {
  release?: Release;
}

/** A render only describes resources. Only its committed boundary may acquire them.
 * Pass the lifetime explicitly through hooks so the owning component is visible.
 * Do not use this for values that can be derived during render or for user actions.
 */
export class RenderLifetime {
  readonly resources: Resource[] = [];

  useBeforePaint(acquire: Acquire, keys?: readonly unknown[]) {
    this.resources.push({ phase: "beforePaint", acquire, keys });
  }

  useAfterCommit(acquire: Acquire, keys?: readonly unknown[]) {
    this.resources.push({ phase: "afterCommit", acquire, keys });
  }

  render(children: ReactNode) {
    return createElement(LifetimeBoundary, { lifetime: this }, children);
  }
}

function sameResource(previous: Resource, next: Resource) {
  return (
    previous.phase === next.phase &&
    previous.keys !== undefined &&
    next.keys !== undefined &&
    previous.keys.length === next.keys.length &&
    previous.keys.every((key, i) => Object.is(key, next.keys![i]))
  );
}

/** Commit engine kept independent of React scheduling for deterministic lifecycle tests. */
export class CommittedLifetime {
  private active: (ActiveResource | undefined)[] = [];

  commit(lifetime: RenderLifetime, phase: Phase) {
    const resources = lifetime.resources;
    // Release every changed resource before acquiring replacements.
    for (let i = 0; i < this.active.length; i++) {
      const previous = this.active[i];
      if (previous?.phase !== phase) continue;
      const next = resources[i];
      if (next && sameResource(previous, next)) continue;
      this.active[i] = undefined;
      previous.release?.();
    }
    for (let i = 0; i < resources.length; i++) {
      const next = resources[i];
      if (next.phase !== phase || this.active[i]) continue;
      const active: ActiveResource = { ...next };
      this.active[i] = active;
      active.release = next.acquire() || undefined;
    }
  }

  dispose() {
    const active = this.active;
    this.active = [];
    const errors: unknown[] = [];
    for (const resource of active) {
      try {
        resource?.release?.();
      } catch (error) {
        errors.push(error);
      }
    }
    if (errors.length === 1) throw normalizeError(errors[0], "resource.cleanup");
    if (errors.length)
      throw normalizeError(
        new AggregateError(errors, "Resource cleanup failed"),
        "resource.cleanup",
      );
  }
}

interface BoundaryProps {
  lifetime: RenderLifetime;
  children?: ReactNode;
}
class LifetimeBoundary extends Component<BoundaryProps, { error: { value: unknown } | null }> {
  state = { error: null as { value: unknown } | null };
  private readonly committed = new CommittedLifetime();
  private pending: RenderLifetime | null = null;
  private generation = 0;

  componentDidMount() {
    this.commit();
  }
  componentDidUpdate(previous: BoundaryProps) {
    if (previous.lifetime !== this.props.lifetime) this.commit();
  }
  componentWillUnmount() {
    this.generation++;
    this.pending = null;
    this.committed.dispose();
  }

  private flush() {
    const pending = this.pending;
    this.pending = null;
    if (pending) this.committed.commit(pending, "afterCommit");
  }

  private commit() {
    this.flush();
    this.committed.commit(this.props.lifetime, "beforePaint");
    this.pending = this.props.lifetime;
    const generation = ++this.generation;
    queueMicrotask(() => {
      if (generation !== this.generation) return;
      try {
        this.flush();
      } catch (error) {
        this.setState({ error: { value: error } });
      }
    });
  }

  render() {
    if (this.state.error) throw normalizeError(this.state.error.value, "resource.acquire");
    return this.props.children;
  }
}
