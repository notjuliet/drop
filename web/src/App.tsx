import type { ParentProps } from "solid-js";

export default function App(props: ParentProps) {
  return (
    <div class="text-text flex min-h-screen flex-col items-center justify-center px-4 font-sans">
      <div class="mt-4 w-full max-w-md">{props.children}</div>
      <p class="text-muted mt-auto pt-8 pb-4 text-[10px]">
        end-to-end encrypted
      </p>
    </div>
  );
}
