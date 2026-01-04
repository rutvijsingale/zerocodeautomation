Feature: Recorded Feature

  Scenario: Recorded Test Flow
    Given I navigate to "https://www.amazon.in/"
    When I Click "Search Amazon.in Field"
    And I Enter "Samsung " In "Search Amazon.in Field"
    And I Click "Samsung s24 ultra 5g mobile"
    Given I navigate to "https://www.amazon.in/s?k=samsung%20s24%20ultra%205g%20mobile&i=aps&ref=nb_sb_ss_mvt-t11-ranker_1_8&crid=2LP3JDVEDSI99&sprefix=Samsung%20%2Caps%2C254"
    Given I navigate to "https://www.amazon.in/s?k=samsung+s24+ultra+5g+mobile&crid=2LP3JDVEDSI99&sprefix=Samsung+%2Caps%2C254&ref=nb_sb_ss_mvt-t11-ranker_1_8"
    Then I should see "SponsoredSponsored You are seeing this ad based on the product’s relevance to your search query.Let us know  Samsung Galaxy S25 Ultra 5G AI Smartphone (Titanium Gray, 12GB RAM, 512GB Storage), 200MP Camera, S Pen Included, Long Battery Life 4.34.3 out of 5 stars (468)  Price, product page₹1,41,999₹1,41,999Flat INR 9000 Off on HDFC BankCardsFlat INR 9000 Off on HDFC BankCardsFREE delivery Mon, 1 DecOr fastest delivery Tomorrow, 30 NovAdd to cart+4 other colors/patterns" in "text="SponsoredSponsored You are seeing this ad based on""
    Then I should see "Samsung Galaxy S25 Ultra 5G AI Smartphone (Titanium Gray, 12GB RAM, 512GB Storage), 200MP Camera, S Pen Included, Long Battery Life" in "text="Samsung Galaxy S25 Ultra 5G AI Smartphone (Titaniu""
    And I scroll to position Y 200
    And I Click "Add To Cart Button"
    And I scroll to position Y 0
    And I Click "Go To Cart Button"
    Given I navigate to "https://www.amazon.in/cart?ref_=ox_ewc_ret_gtc_dsk_in"
    Then I should see "Samsung Galaxy S25 Ultra 5G AI Smartphone (Titanium Gray, 12GB RAM, 512GB Storage), 200MP Camera, S Pen Included, Long Battery LifeSamsung Galaxy S25 Ultra 5G AI Smartphone (Titanium Gray, 12GB RAM, 512GB Storage), 200MP Camera, S Pen Included,…
                
            
            
        
    


    
    
        
            
            Opens in a new tab" in "a.a-link-normal.sc-product-link.sc-product-title.aok-block"
    And I Click "Proceed To Retail Checkout Field"
    Given I navigate to "https://www.amazon.in/ap/signin?openid.pape.max_auth_age=900&openid.return_to=https%3A%2F%2Fwww.amazon.in%2Fcheckout%2Fentry%2Fcart%3FisEligibilityLogicDisabled%3D1%26referrer%3Dcart%26proceedToCheckout%3D1%26proceedToCheckout%3D1%26ref_%3Dox_sc_proceed%26oldCustomerId%3D0%26tangoWeblabStatus%3Dtango_enable_unrec_customer%26sessionID%3D523-3934417-3163567%26pipelineType%3DChewbacca%26isToBeGiftWrappedBefore%3D0%26useDefaultCart%3D1%26isUnrec%3D1&openid.identity=http%3A%2F%2Fspecs.openid.net%2Fauth%2F2.0%2Fidentifier_select&openid.assoc_handle=amazon_checkout_in&openid.mode=checkid_setup&language=en_IN&openid.claimed_id=http%3A%2F%2Fspecs.openid.net%2Fauth%2F2.0%2Fidentifier_select&openid.ns=http%3A%2F%2Fspecs.openid.net%2Fauth%2F2.0"
    And I close the browser
