import { LandingPage } from "@/components/city/LandingPage";
import { AssistantPageContext } from "@/features/assistant/context";

export default function HomePage() {
  return <><AssistantPageContext context={{ page: "home", targets: ["home-process"] }} /><LandingPage /></>;
}
