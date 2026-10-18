import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PrismaService } from "../../../prisma/prisma.service";

@Injectable()
export class CommissionsService {
    constructor(private readonly prismaService: PrismaService
    ) { }

    async getMailingCommissions(mailingId: number, dateFrom: Date | undefined, dateTo: Date | undefined) {

        if (dateFrom && dateTo) {
            const result = await this.prismaService.mailingReservation.aggregate({
                _sum: {
                    heldAmount: true,
                    paidAmount: true,
                },
                where: {
                    mailingId: mailingId,
                    processedAt: {
                        gte: dateFrom,
                        lte: dateTo,
                    },
                },
            })

            const totalCommission =
                (result._sum.heldAmount || 0) - (result._sum.paidAmount || 0)

            return totalCommission;
        }

        const result = await this.prismaService.mailingReservation.aggregate({
            _sum: {
                heldAmount: true,
                paidAmount: true,
            },
            where: {
                mailingId: mailingId,
            },
        })

        const totalCommission =
            (result._sum.heldAmount || 0) - (result._sum.paidAmount || 0)

        return totalCommission;
    }

    async getUserCommissions(userId: number, dateFrom: Date | undefined, dateTo: Date | undefined) {
        if (dateFrom && dateTo) {
            const result = await this.prismaService.mailingReservation.aggregate({
                _sum: {
                    heldAmount: true,
                    paidAmount: true,
                },
                where: {
                    processedAt: {
                        gte: dateFrom,
                        lte: dateTo,
                    },
                    mailing: {
                        userId: userId,
                    },
                },
            })

            const totalCommission =
                (result._sum.heldAmount || 0) - (result._sum.paidAmount || 0)

            return totalCommission;

        }

        const result = await this.prismaService.mailingReservation.aggregate({
            _sum: {
                heldAmount: true,
                paidAmount: true,
            },
            where: {
                mailing: {
                    userId: userId,
                },
            },
        })

        const totalCommission =
            (result._sum.heldAmount || 0) - (result._sum.paidAmount || 0)

        return totalCommission;
    }

        async getTotalCommissions(dateFrom: Date | undefined, dateTo: Date | undefined) {
        if (dateFrom && dateTo) {
            const result = await this.prismaService.mailingReservation.aggregate({
                _sum: {
                    heldAmount: true,
                    paidAmount: true,
                },
                where: {
                    processedAt: {
                        gte: dateFrom,
                        lte: dateTo,
                    },
                },
            })

            const totalCommission =
                (result._sum.heldAmount || 0) - (result._sum.paidAmount || 0)

            return totalCommission;

        }

        const result = await this.prismaService.mailingReservation.aggregate({
            _sum: {
                heldAmount: true,
                paidAmount: true,
            }
        })

        const totalCommission =
            (result._sum.heldAmount || 0) - (result._sum.paidAmount || 0)

        return totalCommission;
    }


}