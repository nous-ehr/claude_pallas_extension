/*
 * athenahealth Patient Search — C# (.NET 8+)
 * ============================================
 * Demonstrates dedup-aware patient search:
 *   1. ALWAYS search for existing patients before creating new ones
 *   2. Use matching parameters to find potential duplicates
 *   3. Only create if no match found
 *
 * ANTI-PATTERN: Creating patients without searching first.
 *   - Creates duplicates that require costly manual merges
 *   - athenahealth flags partners who create excessive duplicates
 *   - Can cause clinical data fragmentation (records split across duplicates)
 */

using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Serialization;

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------
var config = new AthenaConfig
{
    ClientId = Environment.GetEnvironmentVariable("ATHENA_CLIENT_ID")
        ?? throw new InvalidOperationException("ATHENA_CLIENT_ID not set"),
    ClientSecret = Environment.GetEnvironmentVariable("ATHENA_CLIENT_SECRET")
        ?? throw new InvalidOperationException("ATHENA_CLIENT_SECRET not set"),
    PracticeId = Environment.GetEnvironmentVariable("ATHENA_PRACTICE_ID") ?? "195900",
    BaseUrl = Environment.GetEnvironmentVariable("ATHENA_BASE_URL")
        ?? "https://api.preview.platform.athenahealth.com",
};

// ---------------------------------------------------------------------------
// Token management
// ---------------------------------------------------------------------------
var tokenManager = new TokenManager(config);
var client = new AthenaClient(config, tokenManager);

// ---------------------------------------------------------------------------
// Example: Search-then-create workflow
// ---------------------------------------------------------------------------
var firstName = "Jane";
var lastName = "Doe";
var dob = "01/01/1990";

Console.WriteLine($"Searching for patient: {firstName} {lastName} (DOB: {dob})...");
var matches = await client.SearchPatients(firstName, lastName, dob);

if (matches.Count > 0)
{
    Console.WriteLine($"Found {matches.Count} existing patient(s):");
    foreach (var p in matches)
    {
        Console.WriteLine($"  ID: {p.PatientId} — {p.FirstName} {p.LastName} (DOB: {p.Dob})");
    }
    Console.WriteLine("Skipping creation — patient already exists.");
}
else
{
    Console.WriteLine("No match found. Safe to create new patient.");
    // TODO: Call client.CreatePatient(...) here
}

// ===========================================================================
// Types and client implementation below
// ===========================================================================

record AthenaConfig
{
    public required string ClientId { get; init; }
    public required string ClientSecret { get; init; }
    public required string PracticeId { get; init; }
    public required string BaseUrl { get; init; }
}

record TokenResponse
{
    [JsonPropertyName("access_token")]
    public string AccessToken { get; init; } = "";

    [JsonPropertyName("expires_in")]
    public int ExpiresIn { get; init; }
}

record PatientInfo
{
    [JsonPropertyName("patientid")]
    public string PatientId { get; init; } = "";

    [JsonPropertyName("firstname")]
    public string FirstName { get; init; } = "";

    [JsonPropertyName("lastname")]
    public string LastName { get; init; } = "";

    [JsonPropertyName("dob")]
    public string Dob { get; init; } = "";
}

class TokenManager(AthenaConfig config)
{
    private string? _token;
    private DateTime _expiresAt = DateTime.MinValue;
    private readonly HttpClient _http = new();

    public async Task<string> GetTokenAsync()
    {
        if (_token != null && DateTime.UtcNow < _expiresAt.AddMinutes(-1))
            return _token;

        var content = new FormUrlEncodedContent(new Dictionary<string, string>
        {
            ["grant_type"] = "client_credentials",
            ["scope"] = "athenaNet",
        });

        var request = new HttpRequestMessage(HttpMethod.Post, $"{config.BaseUrl}/oauth2/v1/token")
        {
            Content = content,
        };
        request.Headers.Authorization = new AuthenticationHeaderValue(
            "Basic",
            Convert.ToBase64String(
                System.Text.Encoding.ASCII.GetBytes($"{config.ClientId}:{config.ClientSecret}")
            )
        );

        var resp = await _http.SendAsync(request);
        resp.EnsureSuccessStatusCode();

        var data = await resp.Content.ReadFromJsonAsync<TokenResponse>()
            ?? throw new InvalidOperationException("Invalid token response");

        _token = data.AccessToken;
        _expiresAt = DateTime.UtcNow.AddSeconds(data.ExpiresIn);
        return _token;
    }
}

class AthenaClient(AthenaConfig config, TokenManager tokenManager)
{
    private readonly HttpClient _http = new();
    private const int MaxRetries = 5;

    public async Task<List<PatientInfo>> SearchPatients(
        string firstName, string lastName, string dob)
    {
        var path = $"/patients?firstname={Uri.EscapeDataString(firstName)}" +
                   $"&lastname={Uri.EscapeDataString(lastName)}" +
                   $"&dob={Uri.EscapeDataString(dob)}";

        var json = await RequestAsync(HttpMethod.Get, path);
        using var doc = JsonDocument.Parse(json);

        var patients = new List<PatientInfo>();
        if (doc.RootElement.TryGetProperty("patients", out var arr))
        {
            foreach (var el in arr.EnumerateArray())
            {
                patients.Add(JsonSerializer.Deserialize<PatientInfo>(el.GetRawText())!);
            }
        }
        return patients;
    }

    private async Task<string> RequestAsync(HttpMethod method, string path)
    {
        var url = $"{config.BaseUrl}/v1/{config.PracticeId}{path}";

        for (int attempt = 0; attempt < MaxRetries; attempt++)
        {
            var requestId = Guid.NewGuid().ToString();
            var token = await tokenManager.GetTokenAsync();

            var request = new HttpRequestMessage(method, url);
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
            request.Headers.Add("X-Request-Id", requestId);
            request.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));

            var resp = await _http.SendAsync(request);

            if ((int)resp.StatusCode == 429)
            {
                // Rate limited — backoff with jitter
                var wait = Math.Pow(2, attempt) + Random.Shared.NextDouble();
                Console.WriteLine($"Rate limited (429). Waiting {wait:F1}s...");
                await Task.Delay(TimeSpan.FromSeconds(wait));
                continue;
            }

            if (resp.StatusCode == System.Net.HttpStatusCode.Unauthorized)
            {
                // Token expired — will refresh on next loop iteration
                continue;
            }

            resp.EnsureSuccessStatusCode();
            return await resp.Content.ReadAsStringAsync();
        }

        throw new InvalidOperationException($"Max retries exceeded for {method} {url}");
    }
}
