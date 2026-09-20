import { createBrowserRouter, Navigate, redirect } from "react-router-dom";
import { RouteFallback } from "./components/RouteFallback";
import { AuthenticatedAppLayout, PublicLayout, SettingsLayout } from "./layouts/AppLayouts";
import { ForbiddenPage, NotFoundPage, RootErrorBoundary } from "./pages/Errors";

function lazyRoute(loader, exportName) {
  return async () => {
    const module = await loader();
    return { Component: module[exportName], HydrateFallback: RouteFallback };
  };
}

const resources = () => import("./pages/ResourcePages");
const settings = () => import("./pages/SettingsPages");

export const router = createBrowserRouter([
  {
    HydrateFallback: RouteFallback,
    errorElement: <RootErrorBoundary />,
    children: [
      {
        element: <PublicLayout />,
        children: [
          { path: "/login", lazy: lazyRoute(() => import("./pages/LoginPage"), "LoginPage") },
          { path: "/set-password", lazy: lazyRoute(() => import("./pages/SetPasswordPage"), "SetPasswordPage") },
          { path: "/forbidden", element: <ForbiddenPage /> },
        ],
      },
      {
        element: <AuthenticatedAppLayout />,
        children: [
          { index: true, element: <Navigate replace to="/dashboard" /> },
          { path: "/dashboard", lazy: lazyRoute(() => import("./pages/DashboardPage"), "DashboardPage") },
          { path: "/inbox", lazy: lazyRoute(() => import("./pages/WorkQueuePage"), "WorkQueuePage") },
          { path: "/setup", lazy: lazyRoute(() => import("./pages/SetupCenterPage"), "SetupCenterPage") },
          { path: "/contacts", lazy: lazyRoute(resources, "ContactsPage") },
          { path: "/contacts/:contactId", lazy: lazyRoute(resources, "ContactDetailPage") },
          { path: "/leads", lazy: lazyRoute(resources, "LeadsPage") },
          { path: "/leads/new", lazy: lazyRoute(() => import("./pages/NewLeadPage"), "NewLeadPage") },
          { path: "/leads/:leadId", lazy: lazyRoute(() => import("./pages/LeadDetailPage"), "LeadDetailPage") },
          { path: "/opportunities", lazy: lazyRoute(resources, "OpportunitiesPage") },
          { path: "/opportunities/:opportunityId", lazy: lazyRoute(resources, "OpportunityDetailPage") },
          { path: "/tasks", lazy: lazyRoute(resources, "TasksPage") },
          { path: "/tasks/:taskId", lazy: lazyRoute(resources, "TaskDetailPage") },
          {
            path: "/message-drafts/:draftId",
            loader: ({ params }) => redirect(`/message-drafts/${params.draftId}/review`),
          },
          { path: "/message-drafts/:draftId/review", lazy: lazyRoute(() => import("./pages/DraftReviewPage"), "DraftReviewPage") },
          { path: "/reports", lazy: lazyRoute(() => import("./pages/ReportsPage"), "ReportsPage") },
          { path: "/operations", lazy: lazyRoute(() => import("./pages/OperationsPage"), "OperationsPage") },
          {
            path: "/settings",
            element: <SettingsLayout />,
            children: [
              { index: true, element: <Navigate replace to="assignment" /> },
              { path: "members", lazy: lazyRoute(() => import("./pages/MemberManagementPage"), "MemberManagementPage") },
              { path: "assignment", lazy: lazyRoute(settings, "AssignmentSettingsPage") },
              { path: "scoring", lazy: lazyRoute(settings, "ScoringSettingsPage") },
              { path: "channels", lazy: lazyRoute(settings, "ChannelsSettingsPage") },
              { path: "integrations", lazy: lazyRoute(settings, "IntegrationsSettingsPage") },
            ],
          },
        ],
      },
      { path: "*", element: <NotFoundPage /> },
    ],
  },
]);
