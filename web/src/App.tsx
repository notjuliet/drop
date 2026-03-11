import type { ParentProps } from "solid-js";

export default function App(props: ParentProps) {
  return (
    <div class="text-text flex min-h-screen flex-col items-center justify-center px-4 font-sans">
      <div class="mt-6 w-full max-w-2xl">{props.children}</div>
      <a
        class="text-muted hover:text-accent-hover mt-auto px-4 pt-4 text-[10px]"
        style={{ "padding-bottom": "max(1rem, env(safe-area-inset-bottom))" }}
        href="https://github.com/notjuliet/drop"
      >
        source code
      </a>
    </div>
  );
}
