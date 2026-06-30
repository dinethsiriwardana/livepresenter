export interface ParticipantScore {
  token: string;
  name: string;
  quizCorrectCount: number;
  responsesCount: number;
  questionsAskedCount: number;
  upvotesReceivedCount: number;
  upvotesGivenCount: number;
  score: number;
}

export function calculateLeaderboard(
  allResponses: any[],
  qnaList: any[]
): ParticipantScore[] {
  const participants: Record<string, ParticipantScore> = {};

  // Helper to ensure participant entry exists
  const getOrInitParticipant = (token: string, name: string) => {
    if (!participants[token]) {
      participants[token] = {
        token,
        name: name || "Anonymous",
        quizCorrectCount: 0,
        responsesCount: 0,
        questionsAskedCount: 0,
        upvotesReceivedCount: 0,
        upvotesGivenCount: 0,
        score: 0,
      };
    } else if (name && name !== "Anonymous") {
      participants[token].name = name; // Update with latest non-anonymous name
    }
    return participants[token];
  };

  // 1. Process Responses (take only latest response per participant for each unique slide + interaction combo)
  const latestResponses: Record<string, any> = {};
  allResponses.forEach((r) => {
    if (!r.participantToken || !r.slideId || !r.interactionId) return;
    const key = `${r.participantToken}_${r.slideId}_${r.interactionId}`;
    const existing = latestResponses[key];

    const rTime = r.submittedAt?.seconds || (r.submittedAt?.toDate ? r.submittedAt.toDate().getTime() / 1000 : 0);
    const eTime = existing ? (existing.submittedAt?.seconds || (existing.submittedAt?.toDate ? existing.submittedAt.toDate().getTime() / 1000 : 0)) : 0;

    if (!existing || rTime > eTime) {
      latestResponses[key] = r;
    }
  });

  Object.values(latestResponses).forEach((r) => {
    const p = getOrInitParticipant(r.participantToken, r.participantName);
    p.responsesCount += 1;
    if (r.isCorrect === true) {
      p.quizCorrectCount += 1;
    }
  });

  // 2. Process Q&A Questions
  qnaList.forEach((q) => {
    if (!q.participantToken) return;
    const p = getOrInitParticipant(q.participantToken, q.participantName);
    p.questionsAskedCount += 1;
    p.upvotesReceivedCount += (q.upvotes?.length || 0);

    // Track upvotes given (each token in q.upvotes gets an upvoteGiven count)
    if (q.upvotes && Array.isArray(q.upvotes)) {
      q.upvotes.forEach((voterToken: string) => {
        const voter = getOrInitParticipant(voterToken, "Anonymous");
        voter.upvotesGivenCount += 1;
      });
    }
  });

  // 3. Compute final weighted scores
  Object.values(participants).forEach((p) => {
    p.score =
      p.quizCorrectCount * 10 +
      p.responsesCount * 5 +
      p.questionsAskedCount * 3 +
      p.upvotesReceivedCount * 2 +
      p.upvotesGivenCount * 1;
  });

  // 4. Sort by score descending, then quiz correct descending, then responses count descending
  return Object.values(participants).sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (b.quizCorrectCount !== a.quizCorrectCount) return b.quizCorrectCount - a.quizCorrectCount;
    return b.responsesCount - a.responsesCount;
  });
}
