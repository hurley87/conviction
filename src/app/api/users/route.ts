import {
  getAuthenticatedPrivyIdentity,
  PrivyProfileAuthError,
} from "@/lib/privy-profile-auth";
import {
  completeUserOnboarding,
  initializeUser,
  saveUserHandle,
  UserProfileError,
} from "@/lib/users";

type ErrorStatus = 401 | 409 | 422 | 503;

function errorResponse(error: unknown) {
  if (error instanceof PrivyProfileAuthError) {
    return Response.json({ error: error.message }, { status: error.status });
  }
  if (error instanceof UserProfileError) {
    const status: ErrorStatus =
      error.code === "conflict"
        ? 409
        : error.code === "unavailable"
          ? 503
          : 422;
    return Response.json({ error: error.message }, { status });
  }
  return Response.json(
    { error: "The profile service is temporarily unavailable." },
    { status: 503 },
  );
}

async function readBody(request: Request) {
  try {
    return (await request.json()) as Record<string, unknown>;
  } catch {
    throw new UserProfileError("Send a valid JSON body.", "validation");
  }
}

export async function POST(request: Request) {
  try {
    const identity = await getAuthenticatedPrivyIdentity(request);
    const body = await readBody(request);
    const address = body.address;
    if (
      typeof address !== "string" ||
      address.length < 3 ||
      address.length > 200
    ) {
      throw new UserProfileError(
        "An embedded wallet address is required.",
        "validation",
      );
    }
    const profile = await initializeUser({ ...identity, address });
    return Response.json({ profile });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const identity = await getAuthenticatedPrivyIdentity(request);
    const body = await readBody(request);
    let profile;
    if (typeof body.handle === "string") {
      profile = await saveUserHandle(identity.privyId, body.handle);
    } else if (body.onboardingComplete === true) {
      profile = await completeUserOnboarding(identity.privyId);
    } else {
      throw new UserProfileError(
        "Provide a username or mark onboarding complete.",
        "validation",
      );
    }
    return Response.json({ profile });
  } catch (error) {
    return errorResponse(error);
  }
}
