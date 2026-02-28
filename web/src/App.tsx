import type { ParentProps } from "solid-js";

export default function App(props: ParentProps) {
  return (
    <div class="bg-bg text-text flex min-h-screen flex-col items-center justify-center px-4 font-sans">
      <div class="w-full max-w-md">
        <h1 class="mb-6 text-lg font-medium">
          <a
            href="/"
            class="text-text hover:text-accent no-underline transition-colors"
          >
            drop
          </a>
        </h1>
        {props.children}
      </div>
      <p class="text-muted mt-auto pt-8 pb-4 text-[10px]">
        end-to-end encrypted
      </p>
    </div>
  );
}
