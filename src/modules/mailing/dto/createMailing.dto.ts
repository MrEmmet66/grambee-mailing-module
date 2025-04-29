export type CreateMailingDto = {
    botToken: string;
    userId: number;
    content: string;
    mediaType: string;
    buttons: {url: string; text: string}[];
}

// This interface represents the form data with file
export interface CreateMailingFormData extends CreateMailingDto {
    media: Express.Multer.File;
}