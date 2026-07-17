import {
  getAuthenticatedPrivyIdentity,
  PrivyProfileAuthError,
} from "@/lib/privy-profile-auth";
import {
  initializeUserBodySchema,
  patchUserBodySchema,
} from "@/lib/user-profile-request";
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

async function readJson(request: Request) {
  try {
    return await request.json();
  } catch {
    throw new UserProfileError("Send a valid JSON body.", "validation");
  }
}

export async function POST(request: Request) {
  try {
    const identity = await getAuthenticatedPrivyIdentity(request);
    const parsed = initializeUserBodySchema.safeParse(await readJson(request));
    if (!parsed.success) {
      throw new UserProfileError(
        "An embedded wallet address is required.",
        "validation",
      );
    }
    const profile = await initializeUser({
      ...identity,
      address: parsed.data.address,
    });
    return Response.json({ profile });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const identity = await getAuthenticatedPrivyIdentity(request);
    const parsed = patchUserBodySchema.safeParse(await readJson(request));
    if (!parsed.success) {
      throw new UserProfileError(
        "Provide a username or mark onboarding complete.",
        "validation",
      );
    }

    const profile =
      parsed.data.action === "saveHandle"
        ? await saveUserHandle(identity.privyId, parsed.data.handle)
        : await completeUserOnboarding(identity.privyId);

    return Response.json({ profile });
  } catch (error) {
    return errorResponse(error);
  }
}
