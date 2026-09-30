import type { Metadata } from "next";
import { PlatformStory } from "@/components/platform/PlatformStory";
import { AssistantPageContext } from "@/features/assistant/context";

export const metadata: Metadata = {
  title: "О платформе",
  description: "Как предложить идею для области Абай, следить за её рассмотрением и получить ответ в Sevens.",
};

export default function HowPage() {
  return (
    <>
      <AssistantPageContext context={{ page: "how", targets: ["home-process"] }} />
      <PlatformStory />
    </>
  );
}
