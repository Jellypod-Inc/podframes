import { notFound } from "next/navigation";
import { Wizard } from "@/components/studio/wizard/Wizard";
import { ProjectsHome } from "@/components/studio/wizard/ProjectsHome";
import { readProjectDetail, listProjectSummaries } from "@/lib/projects";

export const metadata = {
  title: "Studio — podframes",
};

// Always read fresh project.json on the server (no caching of on-disk state).
export const dynamic = "force-dynamic";

export default async function StudioPage({ searchParams }: { searchParams: Promise<{ slug?: string; new?: string; step?: string }> }) {
  const { slug, new: isNew, step } = await searchParams;
  const initialStep = step && /^[1-5]$/.test(step) ? Number(step) : undefined;

  // ?slug= → resume a project in the wizard. ?new= → a fresh wizard. Otherwise → the projects library.
  if (slug) {
    const initial = await readProjectDetail(slug);
    if (!initial) notFound();
    return <Wizard initial={initial} initialStep={initialStep} />;
  }
  if (isNew) return <Wizard initial={null} initialStep={initialStep} />;

  const projects = await listProjectSummaries();
  return <ProjectsHome projects={projects} />;
}
