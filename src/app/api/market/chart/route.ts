// Server-cached sparkline endpoint for feed charts (issue #4).

import { getSparkline } from "@/lib/market-data";
import { isProductAsset } from "@/lib/verbs/assets";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const asset = searchParams.get("asset") ?? "eth";

  if (!isProductAsset(asset)) {
    return Response.json({ error: "invalid asset" }, { status: 400 });
  }

  const series = await getSparkline(asset);
  return Response.json(
    { asset, series },
    {
      headers: {
        "Cache-Control": "public, max-age=300, stale-while-revalidate=60",
      },
    },
  );
}
