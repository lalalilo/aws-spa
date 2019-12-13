import * as inquirer from "inquirer";
import { predeployPrompt } from "./prompt";

jest.mock("inquirer");

describe("prompt", () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  describe("predeployPrompt", () => {
    const promptMock = jest.spyOn(inquirer, "prompt");

    it("does not prompt if CI is true", async () => {
      await predeployPrompt(true, false);
      expect(promptMock).not.toHaveBeenCalled();
    });

    it("does prompt if CI is not defined", async () => {
      promptMock.mockResolvedValue({ continueDeploy: true });
      await predeployPrompt(false, false);
      expect(promptMock).toHaveBeenCalled();
    });

    it("throws if not confirmed", async () => {
      expect.assertions(1);
      promptMock.mockResolvedValue({ continueDeploy: false });
      try {
        await predeployPrompt(false, false);
      } catch (error) {
        expect(promptMock).toHaveBeenCalled();
      }
    });
  });
});
