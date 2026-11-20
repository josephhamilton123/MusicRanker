import { connection, NextResponse, type NextRequest } from "next/server";

function runtimeEnv(name: string): string {
  const value = (process.env as Record<string, string | undefined>)[name];
  if (typeof value !== "string") {
    return "";
  }
  return value.trim().replace(/^['"]|['"]$/g, "");
}

function apiOrigin(): string {
  const configured = runtimeEnv("API_URL") || runtimeEnv("NEXT_PUBLIC_API_URL") || "http://127.0.0.1:8080";
  return configured.replace(/\/$/, "").replace(/\/api$/, "");
}

async function proxy(request: NextRequest, context: { params: Promise<{ path: string[] }> }): Promise<NextResponse> {
  await connection();
  const { path } = await context.params;
  const target = `${apiOrigin()}/api/${path.map((segment) => encodeURIComponent(segment)).join("/")}${request.nextUrl.search}`;

  const headers = new Headers();
  const contentType = request.headers.get("content-type");
  const accept = request.headers.get("accept");
  if (contentType) {
    headers.set("content-type", contentType);
  }
  if (accept) {
    headers.set("accept", accept);
  }

  try {
    const hasBody = request.method !== "GET" && request.method !== "HEAD";
    const response = await fetch(target, {
      method: request.method,
      headers,
      body: hasBody ? await request.arrayBuffer() : undefined,
      redirect: "manual",
      cache: "no-store",
    });

    const responseHeaders = new Headers();
    const responseType = response.headers.get("content-type");
    if (responseType) {
      responseHeaders.set("content-type", responseType);
    }
    const location = response.headers.get("location");
    if (location) {
      responseHeaders.set("location", location);
    }

    return new NextResponse(response.status === 204 ? null : response.body, {
      status: response.status,
      headers: responseHeaders,
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "The request failed before the API responded.";
    return NextResponse.json({ error: "API is unreachable.", target, detail }, { status: 502 });
  }
}

export const GET = proxy;
export const POST = proxy;
export const PUT = proxy;
export const PATCH = proxy;
export const DELETE = proxy;
