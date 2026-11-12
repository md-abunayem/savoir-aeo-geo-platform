import { ProjectPortal } from "../../../../components/project-portal";
export default async function ProjectProgressPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  return <ProjectPortal view="progress" projectId={(await params).projectId} />;
}
