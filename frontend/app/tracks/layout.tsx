import FloatingMentor from "@/components/FloatingMentor";

export default function TracksLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      {children}
      {/* Global, draggable AI mentor — available across all /tracks routes */}
      <FloatingMentor />
    </>
  );
}
