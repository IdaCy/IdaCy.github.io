import { assertAdmin, requireParticipant } from "../_shared/auth.ts";
import { getEnv } from "../_shared/env.ts";
import { HttpError, json } from "../_shared/http.ts";
import { withRequestPolicy } from "../_shared/policy.ts";

Deno.serve((request) =>
  withRequestPolicy(request, { endpoint: "admin-reset", limit: 10, windowSeconds: 300 }, async () => {
    if (request.method !== "POST") {
      throw new HttpError(405, "Use POST for admin resets.");
    }

    const { allowAdminReset } = getEnv();
    if (!allowAdminReset) {
      throw new HttpError(
        403,
        "Admin reset is disabled. Set HACKATHON_ALLOW_ADMIN_RESET=true only for local or staging use.",
      );
    }

    const { event, participant, serviceClient } = await requireParticipant(request);
    assertAdmin(String(participant.email));

    const assignmentsResult = await serviceClient
      .from("assignments")
      .select("id")
      .eq("event_id", event.id);

    if (assignmentsResult.error) {
      throw new HttpError(500, "Failed to load assignments for reset.", assignmentsResult.error);
    }

    const assignmentIds = (assignmentsResult.data || []).map((row) => row.id);

    if (assignmentIds.length > 0) {
      const submissionsResult = await serviceClient
        .from("submissions")
        .select("id")
        .in("assignment_id", assignmentIds);

      if (submissionsResult.error) {
        throw new HttpError(500, "Failed to load submissions for reset.", submissionsResult.error);
      }

      const submissionIds = (submissionsResult.data || []).map((row) => row.id);

      if (submissionIds.length > 0) {
        const deleteGradingJobs = await serviceClient
          .from("grading_jobs")
          .delete()
          .in("submission_id", submissionIds);
        if (deleteGradingJobs.error) {
          throw new HttpError(500, "Failed to clear grading jobs.", deleteGradingJobs.error);
        }
      }

      const deleteHeartbeats = await serviceClient
        .from("activity_heartbeats")
        .delete()
        .in("assignment_id", assignmentIds);
      if (deleteHeartbeats.error) {
        throw new HttpError(500, "Failed to clear heartbeats.", deleteHeartbeats.error);
      }

      const deleteSubmissions = await serviceClient
        .from("submissions")
        .delete()
        .in("assignment_id", assignmentIds);
      if (deleteSubmissions.error) {
        throw new HttpError(500, "Failed to clear submissions.", deleteSubmissions.error);
      }

      const resetAssignments = await serviceClient
        .from("assignments")
        .update({
          participant_id: null,
          status: "queued",
          claimed_at: null,
          released_at: null,
          submitted_at: null,
        })
        .in("id", assignmentIds);
      if (resetAssignments.error) {
        throw new HttpError(500, "Failed to reset assignments.", resetAssignments.error);
      }
    }

    return json({
      reset: true,
      eventSlug: event.slug,
      assignmentCount: assignmentIds.length,
    });
  })
);
