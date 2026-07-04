import { MentorChatProvider } from "@/components/MentorChatProvider";
import FloatingPrompt from "@/components/FloatingPrompt";

export default function ScenarioLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <MentorChatProvider>
      {children}
      <FloatingPrompt />
    </MentorChatProvider>
  );
}
