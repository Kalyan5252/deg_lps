import { MentorChatProvider } from "@/components/MentorChatProvider";
import FloatingPrompt from "@/components/FloatingPrompt";

export default function TracksLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <MentorChatProvider>
      {children}
      {/* input-only prompt component; messages render in the right chat window */}
      <FloatingPrompt />
    </MentorChatProvider>
  );
}
