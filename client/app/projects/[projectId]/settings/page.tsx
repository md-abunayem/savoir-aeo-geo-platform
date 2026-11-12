import { ProjectPortal } from "../../../../components/project-portal";
export default async function ProjectSettingsPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  return <ProjectPortal view="settings" projectId={(await params).projectId} />;
}
