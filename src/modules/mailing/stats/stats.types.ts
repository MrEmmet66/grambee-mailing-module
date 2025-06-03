export interface BotStatistics {
    totalClicks: number;
    uniqueClicks: number;
    userStats: {
        new: number;
        dead: number;
        premium: number;
        rtl: number;
    };
    conversionStats: {
        performedActions: number;
        passedSponsors: number;
        leftAfterStart: number;
    };
    audienceAnalysis: Record<string, { count: number; percentage: number }>;
}

export interface ChannelStatistics {
    cleanSubscribers: number;
    subscriberTurnover: number;
    audienceCountries: Record<string, { count: number; percentage: number }>;
    resourceLink: string;
}

export interface PeriodStatistics {
    audienceAttracted: number;
    moneySpent: number;
    mailingsPurchased: number;
}

export interface SellerPeriodStatistics {
    mailingsSold: number;
    moneyEarned: number;
    audienceProvided: number;
}

export interface UserMailingStatistics {
    totalAudienceAttracted: number;
    totalMailingsPurchased: number;
    averageDailyVolume: number;
    totalMoneySpent: number;
    periods: {
        day: PeriodStatistics;
        week: PeriodStatistics;
        allTime: PeriodStatistics;
    };
    mailings: {
        link: string;
        audienceAttracted: number;
        moneySpent: number;
    }[];
}

export interface SellerStatistics {
    totalMoneyEarned: number;
    totalMailingsSold: number;
    averageDailyEarnings: number;
    totalAudienceProvided: number;
    periods: {
        day: SellerPeriodStatistics;
        week: SellerPeriodStatistics;
        allTime: SellerPeriodStatistics;
    };
    sellers: {
        link: string;
        audienceProvided: number;
        moneyEarned: number;
    }[];
}

export interface MonthlyUserStatistics {
    month: string; // Format: "2024-01" (YYYY-MM)
    audienceAttracted: number;
    moneySpent: number;
    mailingsPurchased: number;
}

export interface MonthlySellerStatistics {
    month: string; // Format: "2024-01" (YYYY-MM)
    audienceProvided: number;
    moneyEarned: number;
    mailingsSold: number;
}
