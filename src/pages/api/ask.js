export const prerender = false;

export async function POST() {
    return new Response(
        JSON.stringify({ answer: "API работает!" }),
        {
            status: 200,
            headers: { "Content-Type": "application/json" }
        }
    );
}