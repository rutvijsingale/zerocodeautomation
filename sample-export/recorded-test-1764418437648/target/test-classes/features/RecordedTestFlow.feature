Feature: Recorded Feature

  Scenario: Recorded Test Flow
    Given I navigate to "https://www.amazon.in/"
    And I scroll to top
    Then "[aria-label="BF25_Event"]" should be visible
    Then I should see "" in "[aria-label="BF25_Event"]"
    And I scroll to position Y 800
    And I scroll to "Element"
    Given I navigate to "https://www.amazon.in/l/21557580031/?_encoding=UTF8&pd_rd_w=vcZUN&content-id=amzn1.sym.392b8852-991d-4718-ab4a-2ee111c314db&pf_rd_p=392b8852-991d-4718-ab4a-2ee111c314db&pf_rd_r=M4Z11ST78B0D8QNH69XQ&pd_rd_wg=7ZeUC&pd_rd_r=4c8b5d49-7b75-445c-8a5f-e8409efe7e41&ref_=pd_hp_d_hero_unk"
    When I Click "Search Amazon.in Field"
    And I Enter "MObl" In "Search Amazon.in Field"
    And I Enter "MO" In "Search Amazon.in Field"
    And I Enter "Mobile " In "Search Amazon.in Field"
